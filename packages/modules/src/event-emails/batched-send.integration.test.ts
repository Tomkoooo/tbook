import { MongoMemoryServer } from "mongodb-memory-server";
import { DataListModel, DataListRowModel, EventGroupModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { createDataList } from "@tbook/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "../index";
import { EmailDeliveryModel, EventEmailModel } from "./model";
import { createEventEmail, resumeInterruptedEventEmailSends, startEventEmailSend, stopEventEmailSend } from "./service";

/**
 * Manual sends go out in batches (module settings), continue on their own
 * after the runner died, never twice to the same person, and back off when
 * the SMTP server throttles.
 */

type Message = { to: string };
const okTransporter = (log: string[]) => ({
  sendMail: async (message: Message) => {
    log.push(message.to);
    return {} as never;
  },
});
const smtpError = (responseCode: number, text: string) => Object.assign(new Error(`${responseCode} ${text}`), { responseCode });

describe("batched manual sends", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let eventId: string;
  let listId: string;
  const addresses = ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"];

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
    process.env.EMAIL_HOST = "smtp.test.invalid";
    process.env.EMAIL_USER = "noreply@test.invalid";
    process.env.EMAIL_PASS = "x";
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  const setup = async (config: Record<string, string> = {}) => {
    const org = await OrganizationModel.create({ name: "ES", slug: `es-${Date.now()}`, status: "active", modules: { "event-emails": { enabled: true, config } } });
    orgId = String(org._id);
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: "h", apiKeyHint: "x", apiKeyCreatedAt: new Date() });
    const event = await EventModel.create({
      groupId: group._id,
      organizationId: org._id,
      name: "Ünnep",
      status: "active",
      startDate: new Date(Date.now() + 20 * 86_400_000),
      endDate: new Date(Date.now() + 20 * 86_400_000),
      ticketFeeHuf: 0,
      capacity: 100,
    });
    eventId = String(event._id);
    const list = await createDataList(
      orgId,
      { name: "Lista", keyColumn: "id", keyNormalization: "trim_case", emailColumn: "email", nameColumn: "nev", columns: [{ key: "id", label: "ID" }, { key: "nev", label: "Név" }, { key: "email", label: "E-mail" }] },
      addresses.map((email, index) => ({ id: String(index + 1), nev: `Vendég ${index + 1}`, email })),
    );
    listId = String(list.list._id);
    const email = await createEventEmail(orgId, eventId, { name: "Meghívó", subject: "Gyere!", body: "<p>Szia {{firstName}}!</p>", trigger: "manual", audience: "list_all", listId });
    return String(email._id);
  };

  const sendState = async (emailId: string) => (await EventEmailModel.findById(emailId).lean().exec())!.sendState;
  const deliveries = (emailId: string) => EmailDeliveryModel.find({ emailId }).lean().exec();

  beforeEach(async () => {
    await Promise.all(
      [EventModel, EventGroupModel, OrganizationModel, DataListModel, DataListRowModel, EventEmailModel, EmailDeliveryModel].map((m) =>
        (m as unknown as { deleteMany: (q: object) => Promise<unknown> }).deleteMany({}),
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("sends N per batch and waits the configured pause between batches", async () => {
    const emailId = await setup({ sendBatchSize: "2", sendBatchPauseSeconds: "10" });
    const sent: string[] = [];
    const pauses: Array<{ ms: number; sentSoFar: number; phase: unknown; nextBatchAt: unknown; batchSize: unknown }> = [];
    const sleep = async (ms: number) => {
      const state = await sendState(emailId);
      pauses.push({ ms, sentSoFar: sent.length, phase: state.phase, nextBatchAt: state.nextBatchAt, batchSize: state.batchSize });
    };
    await startEventEmailSend(orgId, emailId, null, { wait: true, transporter: okTransporter(sent) as never, sleep });

    expect(sent).toEqual(addresses);
    expect(pauses.map((p) => [p.ms, p.sentSoFar])).toEqual([
      [10_000, 2],
      [10_000, 4],
    ]);
    expect(pauses.every((p) => p.phase === "pausing" && p.nextBatchAt instanceof Date && p.batchSize === 2)).toBe(true);
    expect(await sendState(emailId)).toMatchObject({ status: "done", total: 5, sent: 5, failed: 0, skipped: 0, batchSize: 2, batchPauseSeconds: 10, phase: null });
  });

  it("long pauses keep beating in chunks, and a Stop during the pause ends the run", async () => {
    const emailId = await setup({ sendBatchSize: "2", sendBatchPauseSeconds: "40" });
    const sent: string[] = [];
    const steps: number[] = [];
    const sleep = async (ms: number) => {
      steps.push(ms);
      if (steps.length === 2) await stopEventEmailSend(orgId, emailId);
    };
    await startEventEmailSend(orgId, emailId, null, { wait: true, transporter: okTransporter(sent) as never, sleep });
    expect(sent).toHaveLength(2);
    expect(steps).toEqual([15_000, 15_000]);
    expect(await sendState(emailId)).toMatchObject({ status: "stopped", sent: 2 });
  });

  it("continues an interrupted send on its own, without sending anyone twice", async () => {
    const emailId = await setup();
    const firstRun: string[] = [];
    let release: () => void = () => undefined;
    // The first runner "dies" while sending the third message (it never returns).
    const dying = {
      sendMail: async (message: Message) => {
        if (firstRun.length === 2) await new Promise<void>((resolve) => (release = resolve));
        firstRun.push(message.to);
        return {} as never;
      },
    };
    await startEventEmailSend(orgId, emailId, null, { transporter: dying as never, sleep: async () => undefined });
    await vi.waitFor(async () => expect((await deliveries(emailId)).length).toBe(2));
    expect(await resumeInterruptedEventEmailSends({ wait: true })).toEqual([]); // still beating: not touched

    // The process is gone: its heartbeat gets old.
    await EventEmailModel.updateOne({ _id: emailId }, { $set: { "sendState.heartbeatAt": new Date(Date.now() - 5 * 60_000) } });
    const secondRun: string[] = [];
    const resumed = await resumeInterruptedEventEmailSends({ wait: true, transporter: okTransporter(secondRun) as never, sleep: async () => undefined });
    expect(resumed).toEqual([emailId]);
    expect(secondRun).toEqual(addresses.slice(2));
    expect(await sendState(emailId)).toMatchObject({ status: "done", total: 5, sent: 5, skipped: 0, resumeCount: 1 });

    // The old runner wakes up: it finishes the message it was on, then notices it lost the send and sends nothing more.
    release();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(firstRun).toEqual(addresses.slice(0, 3));
    const rows = await deliveries(emailId);
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.status === "sent")).toBe(true);
    expect((await sendState(emailId)).status).toBe("done");
  });

  it("lets only one runner claim a send (two Sends, two resume jobs)", async () => {
    const emailId = await setup();
    const sent: string[] = [];
    const transporter = okTransporter(sent) as never;
    const outcomes = await Promise.allSettled([
      startEventEmailSend(orgId, emailId, null, { wait: true, transporter, sleep: async () => undefined }),
      startEventEmailSend(orgId, emailId, null, { wait: true, transporter, sleep: async () => undefined }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(sent).toEqual(addresses);

    // A send left running by a dead process, picked up by two instances at once.
    await EmailDeliveryModel.deleteMany({ emailId });
    await EventEmailModel.updateOne({ _id: emailId }, { $set: { "sendState.status": "running", "sendState.heartbeatAt": new Date(Date.now() - 5 * 60_000) } });
    sent.length = 0;
    const [a, b] = await Promise.all([
      resumeInterruptedEventEmailSends({ wait: true, transporter, sleep: async () => undefined }),
      resumeInterruptedEventEmailSends({ wait: true, transporter, sleep: async () => undefined }),
    ]);
    expect([...a, ...b]).toEqual([emailId]);
    expect(sent.sort()).toEqual(addresses);
  });

  it("does not resume a send interrupted too long ago", async () => {
    const emailId = await setup();
    await EventEmailModel.updateOne({ _id: emailId }, { $set: { "sendState.status": "running", "sendState.heartbeatAt": new Date(Date.now() - 3 * 86_400_000) } });
    expect(await resumeInterruptedEventEmailSends({ wait: true })).toEqual([]);
    expect(await sendState(emailId)).toMatchObject({ status: "stopped" });
  });

  it("backs off on throttling and retries the recipient later in the run; permanent failures stay failed", async () => {
    const emailId = await setup({ sendBatchSize: "50", sendBatchPauseSeconds: "10" });
    const attempts: string[] = [];
    const sent: string[] = [];
    const flaky = {
      sendMail: async (message: Message) => {
        attempts.push(message.to);
        if (message.to === "b@example.com" && attempts.filter((to) => to === "b@example.com").length === 1) throw smtpError(421, "4.7.0 Too many connections, try again later");
        if (message.to === "d@example.com") throw smtpError(550, "5.1.1 User unknown");
        sent.push(message.to);
        return {} as never;
      },
    };
    const pauses: Array<{ ms: number; phase: unknown; deferred: unknown }> = [];
    const sleep = async (ms: number) => {
      const state = await sendState(emailId);
      pauses.push({ ms, phase: state.phase, deferred: state.deferred });
    };
    await startEventEmailSend(orgId, emailId, null, { wait: true, transporter: flaky as never, sleep });

    // Throttled: the pause is the batch pause doubled (at least 30 s → 60 s), in heartbeat-sized steps.
    expect(pauses.reduce((sum, p) => sum + p.ms, 0)).toBe(60_000);
    expect(pauses.every((p) => p.phase === "throttled" && p.deferred === 1)).toBe(true);
    expect(sent).toEqual(["a@example.com", "c@example.com", "e@example.com", "b@example.com"]);
    expect(attempts.filter((to) => to === "d@example.com")).toHaveLength(1);
    const rows = await deliveries(emailId);
    expect(rows.find((row) => row.to === "b@example.com")).toMatchObject({ status: "sent", attempts: 1 });
    expect(rows.find((row) => row.to === "d@example.com")).toMatchObject({ status: "failed", temporary: false });
    expect(await sendState(emailId)).toMatchObject({ status: "done", sent: 4, failed: 1, deferred: 0 });

    // A new Send without "retry failed" leaves the permanent failure alone; with it (the default) it is tried again.
    attempts.length = 0;
    await startEventEmailSend(orgId, emailId, null, { wait: true, transporter: flaky as never, sleep, resendFailed: false });
    expect(attempts).toEqual([]);
    expect(await sendState(emailId)).toMatchObject({ status: "done", sent: 0, failed: 1, skipped: 4 });
    await startEventEmailSend(orgId, emailId, null, { wait: true, transporter: flaky as never, sleep });
    expect(attempts).toEqual(["d@example.com"]);
  });
});
