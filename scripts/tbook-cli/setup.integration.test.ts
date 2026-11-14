import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataListModel, DataListRowModel, EventGroupModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { runGroupCommand } from "./commands/group";
import { eventEmails } from "@tbook/modules";
import { createBookingWithCheckout, createOrganization } from "@tbook/services";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runSetupCommand } from "./commands/setup";

/**
 * `setup apply` with the real Hálózatok Ünnepe plan, against a small
 * stand-in staff list: dry run writes nothing; apply grants the modules,
 * imports the list, creates group/event/emails, and a free registration
 * with a listed employee ID goes through.
 */
describe("tbook-cli setup apply", () => {
  let mongod: MongoMemoryServer;
  let uri: string;
  let orgSlug: string;
  let orgId: string;
  let planFile: string;
  const backupsCliDir = path.resolve("backups", "cli");
  let backupsCliExistedBefore = false;

  beforeAll(async () => {
    backupsCliExistedBefore = fs.existsSync(backupsCliDir);
    mongod = await MongoMemoryServer.create();
    uri = `${mongod.getUri()}tbook-setup-test`;
    await dbConnect(uri);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { organization } = await createOrganization({ name: "Eventstructure Test", currency: "HUF" });
    orgId = String(organization.id);
    orgSlug = (await OrganizationModel.findById(orgId))!.slug;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tbook-setup-"));
    const csv = path.join(dir, "dso.csv");
    fs.writeFileSync(csv, "Dolgozó;Név;Vállalat;E-mail cím\n60000001;Teszt Elek;DHEL;teszt@example.com\n60000003;Minta Márta;EHEL;minta@example.com\n");
    const plan = JSON.parse(fs.readFileSync(path.resolve("docs/plans/halozatok-unnepe-2026.setup.json"), "utf8"));
    plan.dataLists[0].file = csv;
    // Open now, so the test can register.
    plan.event.status = "active";
    plan.event.salesOpensAt = null;
    plan.event.salesClosesAt = null;
    planFile = path.join(dir, "plan.json");
    fs.writeFileSync(planFile, JSON.stringify(plan));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await dbDisconnectAll();
    await mongod?.stop();
    if (!backupsCliExistedBefore) {
      fs.rmSync(backupsCliDir, { recursive: true, force: true });
      return;
    }
    // Keep real restore points; drop the ones this test wrote.
    for (const entry of fs.readdirSync(backupsCliDir)) {
      const audit = path.join(backupsCliDir, entry, "audit.json");
      if (fs.existsSync(audit) && JSON.parse(fs.readFileSync(audit, "utf8")).organizationId === orgId) {
        fs.rmSync(path.join(backupsCliDir, entry), { recursive: true, force: true });
      }
    }
  });

  it("dry run validates and writes nothing", async () => {
    await runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri]);
    expect(await EventModel.countDocuments({})).toBe(0);
    expect(await DataListModel.countDocuments({})).toBe(0);
    expect((await OrganizationModel.findById(orgId))?.modules ?? {}).toEqual({});
  });

  it("refuses an unknown email trigger and a second email of the same system trigger", async () => {
    const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    const write = (emails: unknown[]) => {
      const file = planFile.replace(/\.json$/, "-bad.json");
      fs.writeFileSync(file, JSON.stringify({ ...plan, emails }));
      return file;
    };
    await expect(runSetupCommand("apply", ["--org", orgSlug, "--plan", write([{ name: "X", subject: "s", trigger: "on_waitlist" }]), "--uri", uri])).rejects.toThrow(/unknown trigger/);
    const twice = [{ name: "A", subject: "s", trigger: "bus_seat_freed" }, { name: "B", subject: "s", trigger: "bus_seat_freed" }];
    await expect(runSetupCommand("apply", ["--org", orgSlug, "--plan", write(twice), "--uri", uri])).rejects.toThrow(/at most one/);
  });

  it("refuses to write without the confirmation phrase", async () => {
    await expect(runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri, "--apply", "--prod-ack"])).rejects.toThrow(/SETUP/);
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("applies the plan, and the configured registration works", async () => {
    await runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri, "--apply", "--prod-ack", "--confirm", "SETUP"]);

    const org = await OrganizationModel.findById(orgId).lean();
    expect(Object.keys(org?.modules ?? {}).sort()).toEqual(["bus-transport", "event-emails", "feedback", "free-registration", "guest-portal", "waitlist"]);
    const list = await DataListModel.findOne({ organizationId: orgId }).lean();
    expect(list?.rowCount).toBe(2);
    expect(await DataListRowModel.countDocuments({ listId: list?._id })).toBe(2);

    const group = await EventGroupModel.findOne({ organizationId: orgId, name: "MVM Hálózatok Ünnepe 2026" }).lean();
    const event = await EventModel.findOne({ groupId: group?._id }).lean();
    expect(event?.capacity).toBe(1300);
    expect(event?.eligibilityFormRules?.rules[0]?.value).toBe(String(list?._id));
    expect(event?.attendeeFieldSchema.find((f) => f.key === "busz")?.choicesSource).toBe("bus-transport:routes");
    expect(Object.keys((event?.modules ?? {}) as object).sort()).toEqual(["bus-transport", "event-emails", "feedback", "free-registration", "guest-portal", "waitlist"]);
    const modules = event?.modules as Record<string, { enabled: boolean; config?: Record<string, string> }>;
    expect(modules.waitlist).toMatchObject({ enabled: true, config: { mode: "auto" } });
    expect(modules["event-emails"]?.config?.siteUrl).toBe("https://halozatokunnepe2026.hu");

    const emails = await eventEmails.listEventEmails(String(event?._id));
    expect(emails).toHaveLength(11);
    expect(emails.filter((e) => e.trigger === "on_registration")).toHaveLength(2);
    // System emails (R1–R4): one per module message this event sends.
    const system = emails.filter((e) => eventEmails.isSystemEmailTrigger(e.trigger));
    expect(system.map((e) => e.trigger).sort()).toEqual(["booking_cancelled", "bus_captain_notice", "bus_seat_freed", "waitlist_joined", "waitlist_registered"]);
    expect(system.filter((e) => e.trigger !== "bus_captain_notice").every((e) => e.name.startsWith("R") && e.active && e.audience === "registered")).toBe(true);
    expect(emails.find((e) => e.audience === "list_unregistered")?.listId?.toString()).toBe(String(list?._id));

    const attendee = (id: string) => ({
      fields: { nev: "Teszt Elek", torzsszam: id, munkaltato: "DHEL", email: "teszt@example.com", telefon: "+36301112233", transzfer: "nem", vacsora: "igen", adatkezeles: "true" },
    });
    const customer = { name: "Teszt Elek", email: "teszt@example.com", phone: "+36301112233", note: "" };
    const ok = await createBookingWithCheckout({ eventId: String(event?._id), guests: 1, customer, attendees: [attendee("60000001")] }, { groupId: String(group?._id) });
    expect(ok.status).toBe("confirmed");
    await expect(
      createBookingWithCheckout({ eventId: String(event?._id), guests: 1, customer, attendees: [attendee("99999999")] }, { groupId: String(group?._id) }),
    ).rejects.toThrow(/nem találunk jogosult munkatársat/);
  });

  it("won't create the same event twice", async () => {
    await expect(runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri, "--apply", "--prod-ack", "--confirm", "SETUP"])).rejects.toThrow(/already exists/);
  });

  it("--update brings an existing event's modules, settings and emails in line, leaving the event itself alone", async () => {
    const event = (await EventModel.findOne({ name: "MVM Hálózatok Ünnepe 2026" }))!;
    const eventId = String(event._id);
    const emails = await eventEmails.listEventEmails(eventId);
    const first = emails.find((e) => e.name.startsWith("1."))!;
    const others = emails.filter((e) => e !== first).map((e) => ({ id: String(e._id), updatedAt: e.updatedAt.getTime() }));
    // The state before this change: no password line, no site URL, guest modules off, a console-set survey link, event in draft.
    await eventEmails.EventEmailModel.updateOne({ _id: first._id }, { $set: { body: first.body.replace(/<p>A weboldal jelszóval védett.*?<\/p>/, "") } });
    await EventModel.updateOne(
      { _id: eventId },
      {
        $set: { status: "draft", "modules.event-emails.config.siteUrl": "", "modules.event-emails.config.surveyUrl": "https://kerdoiv.example.com" },
        $unset: { "modules.guest-portal": "", "modules.waitlist": "", "modules.feedback": "" },
      },
    );

    await runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri, "--update"]);
    expect((await eventEmails.EventEmailModel.findById(first._id))!.body).not.toContain("jelszóval");
    await expect(runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri, "--update", "--apply", "--prod-ack"])).rejects.toThrow(/UPDATE/);

    await runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri, "--update", "--apply", "--prod-ack", "--confirm", "UPDATE"]);
    const after = (await EventModel.findById(eventId).lean())!;
    expect(after.status).toBe("draft");
    const modules = after.modules as Record<string, { enabled: boolean; config?: Record<string, string> }>;
    expect(modules["guest-portal"]?.enabled).toBe(true);
    expect(modules.waitlist).toMatchObject({ enabled: true, config: { mode: "auto" } });
    expect(modules.feedback?.enabled).toBe(true);
    expect(modules["event-emails"]?.config).toMatchObject({ siteUrl: "https://halozatokunnepe2026.hu", surveyUrl: "https://kerdoiv.example.com" });
    expect((await eventEmails.EventEmailModel.findById(first._id))!.body).toContain("<strong>HalozatokUnnepe2026</strong>");
    for (const other of others) expect((await eventEmails.EventEmailModel.findById(other.id))!.updatedAt.getTime()).toBe(other.updatedAt);

    // Idempotent: a second run has nothing to do.
    const log = vi.mocked(console.log);
    log.mockClear();
    await runSetupCommand("apply", ["--org", orgSlug, "--plan", planFile, "--uri", uri, "--update", "--apply", "--prod-ack", "--confirm", "UPDATE"]);
    expect(log.mock.calls.flat().join("\n")).toMatch(/Nothing to change/);
  });

  it("group keys: issues a preview key once (with the phrase), reveals it, never shows the API key", async () => {
    const group = (await EventGroupModel.findOne({ organizationId: orgId }))!;
    const id = String(group._id);
    const log = vi.mocked(console.log);
    log.mockClear();
    await runGroupCommand("keys", ["--org", orgSlug, "--id", id, "--uri", uri, "--rotate-preview"]);
    expect((await EventGroupModel.findById(id))!.previewKeyHash).toBeNull();
    await expect(runGroupCommand("keys", ["--org", orgSlug, "--id", id, "--uri", uri, "--rotate-preview", "--apply", "--prod-ack"])).rejects.toThrow(/ROTATE/);
    await runGroupCommand("keys", ["--org", orgSlug, "--id", id, "--uri", uri, "--rotate-preview", "--apply", "--prod-ack", "--confirm", "ROTATE"]);
    const printed = log.mock.calls.flat().join("\n");
    const key = /Preview key \(X-TBook-Preview\): (tbp_\w+)/.exec(printed)?.[1];
    expect(key).toBeTruthy();
    expect((await EventGroupModel.findById(id))!.apiKeyHash).toBe(group.apiKeyHash);

    log.mockClear();
    await runGroupCommand("keys", ["--org", orgSlug, "--id", id, "--uri", uri, "--reveal-preview"]);
    expect(log.mock.calls.flat().join("\n")).toContain(key!);
  });
});
