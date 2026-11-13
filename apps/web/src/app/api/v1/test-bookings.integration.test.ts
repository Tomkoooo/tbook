import fs from "node:fs";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  BookingModel,
  DataListModel,
  DataListRowModel,
  EventGroupModel,
  EventModel,
  FieldClaimModel,
  OrganizationModel,
  VoucherModel,
  dbConnect,
  dbDisconnectAll,
} from "@tbook/db";
import { busTransport, eventEmails, feedback, setModuleMailTransporter, waitlist } from "@tbook/modules";
import { generateApiKey, hashApiKey, listBookingsForOrg, rotateEventGroupPreviewKey, scanVoucher } from "@tbook/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runBookingCommand } from "../../../../../../scripts/tbook-cli/commands/booking";
import { GET as getEvent } from "./events/[eventId]/route";
import { POST as postBooking } from "./bookings/route";
import { POST as guestCancel } from "./guest/cancel/route";
import { POST as guestLookup } from "./guest/lookup/route";
import { POST as surveyAnswer } from "./surveys/[surveyId]/responses/route";
import { POST as waitlistJoin } from "./waitlist/join/route";
import { POST as waitlistStatus } from "./waitlist/status/route";

/**
 * Test bookings (X-TBook-Preview + X-TBook-Test: 1) through the real v1
 * routes: really saved and emailed ("[TESZT] "), on a draft event, and
 * kept apart from live data — no capacity, no bus seats, their own ID
 * namespace and waitlist queue, invisible without the preview key — and
 * removed by `tbook-cli booking purge-test`.
 */

type Mail = { to: string; subject: string; html: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const sent: Mail[] = [];
const transporter = {
  sendMail: async (message: Mail) => {
    sent.push(message);
    return {} as never;
  },
};

const on = { enabled: true };
const MODULES = {
  "free-registration": on,
  "bus-transport": on,
  "event-emails": { enabled: true, config: { siteUrl: "https://halozatokunnepe2026.hu" } },
  "guest-portal": on,
  waitlist: { enabled: true, config: { mode: "auto" } },
  feedback: on,
};
const FIELDS = [
  { key: "name", label: "Név", type: "text", required: true, sortOrder: 0 },
  { key: "employee_id", label: "Törzsszám", type: "text", required: true, unique: true, identifier: true, sortOrder: 1 },
  { key: "email", label: "E-mail", type: "email", required: true, sortOrder: 2 },
  { key: "transfer", label: "Transzfer", type: "select", required: true, choices: [{ value: "igen", label: "Igen" }, { value: "nem", label: "Nem" }], sortOrder: 3 },
  { key: "bus", label: "Busz", type: "select", required: true, choicesSource: "bus-transport:routes", showWhen: { fieldKey: "transfer", values: ["igen"] }, sortOrder: 4 },
];
const customer = { name: "Teszt Elek", email: "leader@example.com", phone: "+36301112233", note: "" };

describe("v1: test bookings (X-TBook-Test)", () => {
  let mongod: MongoMemoryServer;
  let uri: string;
  let orgId: string;
  let eventId: string;
  let apiKey: string;
  let previewKey: string;
  const backupsCliDir = path.resolve("backups", "cli");
  let backupsExisted = false;

  beforeAll(async () => {
    backupsExisted = fs.existsSync(backupsCliDir);
    mongod = await MongoMemoryServer.create();
    uri = `${mongod.getUri()}tbook-test-bookings`;
    process.env.DATABASE_URL = uri;
    await dbConnect(uri);
    process.env.EMAIL_HOST = "smtp.test.invalid";
    process.env.EMAIL_USER = "noreply@test.invalid";
    process.env.EMAIL_PASS = "x";
    process.env.TBOOK_RATE_LIMIT_OVERRIDE = "100000";
    eventEmails.setEventEmailTransporter(transporter as never);
    waitlist.setWaitlistTransporter(transporter as never);
    setModuleMailTransporter(transporter as never);
  });

  afterAll(async () => {
    eventEmails.setEventEmailTransporter(undefined);
    waitlist.setWaitlistTransporter(undefined);
    setModuleMailTransporter(undefined);
    delete process.env.TBOOK_RATE_LIMIT_OVERRIDE;
    await dbDisconnectAll();
    await mongod?.stop();
    if (!backupsExisted) fs.rmSync(backupsCliDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await Promise.all(
      [
        BookingModel,
        EventModel,
        EventGroupModel,
        OrganizationModel,
        VoucherModel,
        FieldClaimModel,
        DataListModel,
        DataListRowModel,
        busTransport.BusRouteModel,
        busTransport.BusWaitlistEntryModel,
        busTransport.BusSeatStateModel,
        eventEmails.EventEmailModel,
        eventEmails.EmailDeliveryModel,
        waitlist.WaitlistEntryModel,
        feedback.SurveyModel,
        feedback.SurveyResponseModel,
        feedback.SurveyRespondentModel,
      ].map((m) => (m as unknown as { deleteMany: (q: object) => Promise<unknown> }).deleteMany({})),
    );
    sent.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const org = await OrganizationModel.create({ name: "Eventstructure", slug: "eventstructure", status: "active", modules: MODULES });
    orgId = String(org._id);
    apiKey = generateApiKey();
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: hashApiKey(apiKey), apiKeyHint: "tbk_x", apiKeyCreatedAt: new Date() });
    previewKey = (await rotateEventGroupPreviewKey(orgId, String(group._id))).previewKey;
    const event = await (EventModel as unknown as { create(doc: object): Promise<{ _id: unknown }> }).create({
      groupId: group._id,
      organizationId: orgId,
      name: "MVM Hálózatok Ünnepe 2026",
      status: "draft",
      startDate: new Date(Date.now() + 20 * 86_400_000),
      endDate: new Date(Date.now() + 20 * 86_400_000),
      ticketFeeHuf: 0,
      capacity: 2,
      vouchersEnabled: true,
      attendeeFieldSchemaMode: "replace",
      attendeeFieldSchema: FIELDS,
      modules: MODULES,
    });
    eventId = String(event._id);
    await eventEmails.createEventEmail(orgId, eventId, {
      name: "Visszaigazolás",
      subject: "Visszaigazolás – {{registrationNumber}}",
      body: "<p>Szia {{firstName}}! Transzfer: {{bus.transfer}}</p>",
      trigger: "on_registration",
      audience: "registered",
    });
  });

  // ---- helpers -----------------------------------------------------------------------

  const PREVIEW = () => ({ "X-TBook-Preview": previewKey });
  const TEST = () => ({ "X-TBook-Preview": previewKey, "X-TBook-Test": "1" });
  const post = async (handler: unknown, p: string, body: unknown, extra: Record<string, string> = {}, ctx?: unknown) => {
    const response = await (handler as (r: Request, c?: unknown) => Promise<Response>)(
      new Request(`https://tbook.test/api/v1/${p}`, { method: "POST", headers: { "X-TBook-Api-Key": apiKey, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) }),
      ctx,
    );
    return { status: response.status, body: (await response.json()) as Json };
  };
  const readEvent = async (extra: Record<string, string> = {}) => {
    const response = await getEvent(new Request(`https://tbook.test/api/v1/events/${eventId}`, { headers: { "X-TBook-Api-Key": apiKey, ...extra } }), {
      params: Promise.resolve({ eventId }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const guest = (id: string, fields: Record<string, string> = {}) => ({ fields: { name: `Vendég ${id}`, employee_id: id, email: `${id}@example.com`, transfer: "nem", ...fields } });
  const book = (attendees: ReturnType<typeof guest>[], extra: Record<string, string> = {}) =>
    post(postBooking, "bookings", { eventId, guests: attendees.length, customer, attendees }, extra);
  const join = (attendees: ReturnType<typeof guest>[], email: string, extra: Record<string, string> = {}) =>
    post(waitlistJoin, "waitlist/join", { eventId, guests: attendees.length, customer: { ...customer, email }, attendees }, extra);
  const cancel = (code: string, extra: Record<string, string> = {}) => post(guestCancel, "guest/cancel", { eventId, code }, extra);
  const lookup = (code: string, extra: Record<string, string> = {}) => post(guestLookup, "guest/lookup", { eventId, code }, extra);
  const sold = async () => (await EventModel.findById(eventId))!.soldGuestCount;
  const activate = () => EventModel.updateOne({ _id: eventId }, { $set: { status: "active" } });
  const mailsTo = (to: string) => sent.filter((m) => m.to === to);

  // ---- the header ---------------------------------------------------------------------

  it("X-TBook-Test is ignored without a valid preview key", async () => {
    // Draft event: without the preview key it doesn't exist, test header or not.
    expect((await book([guest("1001")], { "X-TBook-Test": "1" })).status).toBe(404);
    expect((await book([guest("1001")], { "X-TBook-Test": "1", "X-TBook-Preview": "tbp_wrong_key_123456789" })).status).toBe(404);

    // Active event: a normal live booking, not a test.
    await activate();
    const live = await book([guest("1001")], { "X-TBook-Test": "1" });
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    expect(live.body.test).toBeUndefined();
    const booking = await BookingModel.findById(live.body.bookingId);
    expect(booking!.isTest).toBe(false);
    expect(await sold()).toBe(1);
    expect(sent.every((m) => !m.subject.startsWith("[TESZT]"))).toBe(true);

    // Only "1" switches it on; the preview key alone stays a dry run.
    const dry = await book([guest("1002")], { ...PREVIEW(), "X-TBook-Test": "yes" });
    expect(dry.body).toMatchObject({ preview: true, bookingId: null });
  });

  it("a test booking on a draft event is saved as a test, answers test:true and sends [TESZT] emails", async () => {
    const result = await book([guest("2001"), guest("2002")], TEST());
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ test: true, status: "confirmed" });
    expect(result.body.registrationNumber).toBeTruthy();
    expect(result.body.preview).toBeUndefined();

    const booking = await BookingModel.findById(result.body.bookingId);
    expect(booking).toMatchObject({ isTest: true, status: "confirmed" });
    expect(await VoucherModel.countDocuments({ bookingId: booking!._id, isTest: true })).toBe(2);
    // Live counters untouched; the ID claim is in the test namespace.
    expect(await sold()).toBe(0);
    expect(await FieldClaimModel.countDocuments({ fieldKey: "employee_id" })).toBe(0);
    expect(await FieldClaimModel.countDocuments({ fieldKey: "test:employee_id", isTest: true })).toBe(2);

    const mail = mailsTo("2001@example.com");
    expect(mail.map((m) => m.subject)).toEqual([`[TESZT] Visszaigazolás – ${booking!.attendees[0]!.registrationNumber}`]);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.subject.startsWith("[TESZT] "))).toBe(true);

    // The same test ID twice is refused (among tests).
    expect((await book([guest("2001")], TEST())).status).toBe(400);

    // Guest portal in preview: found, with test:true. Cancelling sends a [TESZT] cancellation.
    const found = await lookup("2001", PREVIEW());
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(found.body.guest.test).toBe(true);
    sent.length = 0;
    const cancelled = await cancel("2002", PREVIEW());
    expect(cancelled.body).toMatchObject({ cancelled: true, test: true });
    expect(mailsTo("2002@example.com").map((m) => m.subject)).toEqual(["[TESZT] Regisztráció lemondva – MVM Hálózatok Ünnepe 2026"]);
    expect(await sold()).toBe(0);
  });

  it("test records are invisible without the preview key", async () => {
    expect((await book([guest("3001")], TEST())).status).toBe(200);
    expect((await join([guest("3002")], "t@example.com", TEST())).status).toBe(200);
    // Draft: guest endpoints need the preview key.
    expect((await lookup("3001")).status).toBe(404);
    expect((await lookup("3001", PREVIEW())).status).toBe(200);

    // Even on an active event a test registration is "not found" without the key.
    await activate();
    expect((await lookup("3001")).status).toBe(404);
    expect((await cancel("3001")).status).toBe(404);
    expect((await post(waitlistStatus, "waitlist/status", { eventId, code: "3002" })).status).toBe(404);
    const status = await post(waitlistStatus, "waitlist/status", { eventId, code: "3002" }, PREVIEW());
    expect(status.body).toMatchObject({ test: true, entry: { position: 1, status: "waiting" } });
    expect(await BookingModel.countDocuments({ isTest: true, status: "confirmed" })).toBe(1);

    // Survey answers: test code only with the key; stored as test, left out of results.
    const survey = await feedback.createSurvey(orgId, eventId, { kind: "survey", title: "Visszajelzés", questions: [{ type: "rating", label: "Milyen volt?" }] });
    const questionId = survey.questions[0]!.id;
    const ctx = { params: Promise.resolve({ surveyId: String(survey._id) }) };
    expect((await post(surveyAnswer, `surveys/${survey._id}/responses`, { code: "3001", answers: { [questionId]: 5 } }, {}, ctx)).status).toBe(400);
    const answered = await post(surveyAnswer, `surveys/${survey._id}/responses`, { code: "3001", answers: { [questionId]: 5 } }, PREVIEW(), { params: Promise.resolve({ surveyId: String(survey._id) }) });
    expect(answered.body.test).toBe(true);
    expect((await feedback.surveyResults(orgId, String(survey._id))).total).toBe(0);
  });

  // ---- isolation from live data ---------------------------------------------------------

  it("a full event still takes test bookings, and live capacity, waitlist mode and admin statistics don't move", async () => {
    await activate();
    expect((await book([guest("4001")])).body.status).toBe("confirmed");
    expect((await book([guest("4002")])).body.status).toBe("confirmed");
    expect((await book([guest("4003")])).body.code).toBe("capacity_full");

    const testBooking = await book([guest("4101"), guest("4102"), guest("4103")], TEST());
    expect(testBooking.status, JSON.stringify(testBooking.body)).toBe(200);
    expect(await sold()).toBe(2);
    const { body } = await readEvent();
    expect(body).toMatchObject({ remainingPlaces: 0, waitlistOpen: true, salesState: "on_sale" });
    expect((await book([guest("4004")])).body.code).toBe("capacity_full");

    // Statistics, check-in lists and scans leave tests out; the list shows them (TESZT badge).
    const list = await listBookingsForOrg(orgId, { eventId });
    expect(list.total).toBe(3);
    expect(list.paidGuests).toBe(2);
    expect(list.statusTotals.reduce((sum, t) => sum + t.count, 0)).toBe(2);
    const testVoucher = await VoucherModel.findOne({ isTest: true });
    expect((await scanVoucher(testVoucher!.token, { organizationId: orgId, eventId })).result).toBe("invalid");
  });

  it("a test ID never blocks a live registration, and a live ID never blocks a test", async () => {
    await activate();
    expect((await book([guest("5001")], TEST())).status).toBe(200);
    const live = await book([guest("5001")]);
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    expect(live.body.test).toBeUndefined();

    expect((await book([guest("5002")])).status).toBe(200);
    expect((await book([guest("5002")], TEST())).status).toBe(200);

    // Lookups: without the key the live guest, with the key the test guest first.
    expect((await lookup("5001")).body.guest.test).toBeUndefined();
    expect((await lookup("5001", PREVIEW())).body.guest.test).toBe(true);
    expect(await BookingModel.countDocuments({ "attendees.fields.employee_id": "5001", status: "confirmed" })).toBe(2);
  });

  it("separate waitlist queues: a live cancellation promotes the live head, a test cancellation the test head", async () => {
    await activate();
    expect((await book([guest("6001")])).body.status).toBe("confirmed");
    expect((await book([guest("6002")])).body.status).toBe("confirmed");
    const liveA = await join([guest("6101")], "a@example.com");
    const testT = await join([guest("6201")], "t@example.com", TEST());
    const liveB = await join([guest("6102")], "b@example.com");
    expect(liveA.body).toMatchObject({ position: 1 });
    expect(liveA.body.test).toBeUndefined();
    expect(testT.body).toMatchObject({ position: 1, test: true });
    expect(liveB.body).toMatchObject({ position: 2 });
    expect(mailsTo("t@example.com")[0]!.subject).toBe("[TESZT] Felkerültél a várólistára – MVM Hálózatok Ünnepe 2026");
    expect(mailsTo("a@example.com")[0]!.subject).toBe("Felkerültél a várólistára – MVM Hálózatok Ünnepe 2026");

    // A test join works even with places left (no capacity involved).
    expect((await join([guest("6202")], "t2@example.com", TEST())).body).toMatchObject({ position: 2, test: true });

    // A test booking is made and then cancelled: only the test queue moves.
    expect((await book([guest("6301")], TEST())).status).toBe(200);
    sent.length = 0;
    expect((await cancel("6301", PREVIEW())).status).toBe(200);
    const t = await waitlist.WaitlistEntryModel.findOne({ "customer.email": "t@example.com" });
    expect(t!.status).toBe("registered");
    expect((await BookingModel.findById(t!.bookingId))!.isTest).toBe(true);
    expect((await waitlist.WaitlistEntryModel.findOne({ "customer.email": "a@example.com" }))!.status).toBe("waiting");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.subject.startsWith("[TESZT] "))).toBe(true);
    expect(await sold()).toBe(2);

    // A live cancellation promotes the live head only.
    sent.length = 0;
    expect((await cancel("6001")).status).toBe(200);
    const a = await waitlist.WaitlistEntryModel.findOne({ "customer.email": "a@example.com" });
    expect(a!.status).toBe("registered");
    expect((await BookingModel.findById(a!.bookingId))!.isTest).toBe(false);
    expect((await waitlist.WaitlistEntryModel.findOne({ "customer.email": "t2@example.com" }))!.status).toBe("waiting");
    expect(sent.every((m) => !m.subject.startsWith("[TESZT]"))).toBe(true);
    expect(await sold()).toBe(2);
  });

  it("test bookings take no bus seats; seat notices never cross between live and test guests", async () => {
    await activate();
    await EventModel.updateOne({ _id: eventId }, { $set: { capacity: 100 } });
    const routeId = String((await busTransport.createRoute(orgId, eventId, { code: "B1", city: "Pécs", capacity: 1 }))._id);
    expect((await book([guest("7101", { transfer: "igen", bus: routeId })], TEST())).status).toBe(200);
    expect((await busTransport.BusRouteModel.findById(routeId))!.seatsTaken).toBe(0);
    expect((await book([guest("7001", { transfer: "igen", bus: routeId })])).body.status).toBe("confirmed");
    expect((await busTransport.BusRouteModel.findById(routeId))!.seatsTaken).toBe(1);
    expect((await busTransport.listPassengers((await busTransport.BusRouteModel.findById(routeId))!)).map((p) => p.name)).toEqual(["Vendég 7001"]);

    // Both wait for the full bus.
    expect((await book([guest("7002", { transfer: "igen", bus: "waitlist" })])).status).toBe(200);
    expect((await book([guest("7102", { transfer: "igen", bus: "waitlist" })], TEST())).status).toBe(200);
    expect((await busTransport.listBusWaitlist(eventId)).map((r) => r.name)).toEqual(["Vendég 7002"]);
    expect((await lookup("7102", PREVIEW())).body.guest.busWaitlist).toEqual({ position: 1 });

    // The test guest on the bus cancels: only the test line hears about it, live seats unchanged.
    sent.length = 0;
    await cancel("7101", PREVIEW());
    const notice = (m: Mail) => /Felszabadult hely a buszon/.test(m.subject);
    expect(sent.filter(notice).map((m) => [m.to, m.subject.startsWith("[TESZT] ")])).toEqual([["7102@example.com", true]]);
    expect((await busTransport.BusRouteModel.findById(routeId))!.seatsTaken).toBe(1);

    // The live guest cancels: only the live line.
    sent.length = 0;
    await cancel("7001");
    expect(sent.filter(notice).map((m) => m.to)).toEqual(["7002@example.com"]);
    expect((await busTransport.BusRouteModel.findById(routeId))!.seatsTaken).toBe(0);
  });

  // ---- purge -------------------------------------------------------------------------

  it("purge-test: a dry run lists, --apply removes every test record, sends nothing, keeps live data and frees the test ID", async () => {
    await activate();
    expect((await book([guest("8001")])).body.status).toBe("confirmed");
    const routeId = String((await busTransport.createRoute(orgId, eventId, { code: "B1", city: "Győr", capacity: 5 }))._id);
    expect((await book([guest("8101", { transfer: "igen", bus: routeId }), guest("8102", { transfer: "igen", bus: "waitlist" })], TEST())).status).toBe(200);
    expect((await book([guest("8103")], TEST())).status).toBe(200);
    expect((await join([guest("8201")], "tw@example.com", TEST())).status).toBe(200);
    const survey = await feedback.createSurvey(orgId, eventId, { kind: "survey", title: "S", questions: [{ type: "rating", label: "Q" }] });
    await post(surveyAnswer, `surveys/${survey._id}/responses`, { code: "8103", answers: { [survey.questions[0]!.id]: 4 } }, PREVIEW(), {
      params: Promise.resolve({ surveyId: String(survey._id) }),
    });
    const liveBefore = { sold: await sold(), seats: (await busTransport.BusRouteModel.findById(routeId))!.seatsTaken, bookings: await BookingModel.countDocuments({ isTest: false }) };
    expect(await eventEmails.EmailDeliveryModel.countDocuments({})).toBeGreaterThan(1);

    const args = ["--org", "eventstructure", "--uri", uri, "--event", eventId];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runBookingCommand("purge-test", args);
    expect(await BookingModel.countDocuments({ isTest: true })).toBe(2); // dry run
    await expect(runBookingCommand("purge-test", [...args, "--apply", "--prod-ack"])).rejects.toThrow(/--confirm=PURGE/);
    expect(await BookingModel.countDocuments({ isTest: true })).toBe(2);

    sent.length = 0;
    await runBookingCommand("purge-test", [...args, "--apply", "--prod-ack", "--confirm", "PURGE"]);
    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    log.mockRestore();
    expect(output).toMatch(/DRY RUN/);
    expect(output).toMatch(/Restore point: .*booking-purge-test-/);

    expect(sent).toHaveLength(0);
    expect(await BookingModel.countDocuments({ isTest: true })).toBe(0);
    expect(await VoucherModel.countDocuments({ isTest: true })).toBe(0);
    expect(await FieldClaimModel.countDocuments({ isTest: true })).toBe(0);
    expect(await waitlist.WaitlistEntryModel.countDocuments({ isTest: true })).toBe(0);
    expect(await busTransport.BusWaitlistEntryModel.countDocuments({})).toBe(0);
    expect(await feedback.SurveyResponseModel.countDocuments({})).toBe(0);
    expect(await feedback.SurveyRespondentModel.countDocuments({})).toBe(0);
    expect(await eventEmails.EmailDeliveryModel.countDocuments({ bookingId: { $ne: null } })).toBe(1); // the live guest's
    expect({ sold: await sold(), seats: (await busTransport.BusRouteModel.findById(routeId))!.seatsTaken, bookings: await BookingModel.countDocuments({ isTest: false }) }).toEqual(liveBefore);

    const dir = output.match(/Restore point: (\S+)/)![1]!;
    expect(fs.existsSync(path.join(dir, "before.json"))).toBe(true);
    // The test IDs are free again.
    expect((await book([guest("8101")], TEST())).status).toBe(200);
  });
});
