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
import { busTransport, eventEmails, setModuleMailTransporter, waitlist } from "@tbook/modules";
import { createDataList, generateApiKey, hashApiKey, rotateEventGroupPreviewKey } from "@tbook/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getEvent } from "./events/[eventId]/route";
import { POST as prefill } from "./events/[eventId]/prefill/route";
import { POST as postBooking } from "./bookings/route";
import { POST as guestCancel } from "./guest/cancel/route";
import { POST as guestLookup } from "./guest/lookup/route";
import { POST as guestUpdate } from "./guest/update/route";
import { POST as waitlistJoin } from "./waitlist/join/route";
import { POST as waitlistLeave } from "./waitlist/leave/route";
import { POST as waitlistStatus } from "./waitlist/status/route";

/**
 * The Hálózatok Ünnepe contract the event site is built against, through
 * the real v1 route handlers: the 1,300 cap and the event waitlist (join
 * email, status, leave, automatic promotion on cancel, no double
 * promotion), the bus waitlist ("értesítést kérek"), preview mode
 * (X-TBook-Preview) and the rule that a waitlisted ID can't also book.
 */

type Mail = { to: string; subject: string; html: string };
// Response bodies are loose JSON, read only in assertions.
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
const SITE = "https://halozatokunnepe2026.hu";
const MODULES = {
  "free-registration": on,
  "bus-transport": on,
  "event-emails": { enabled: true, config: { siteUrl: SITE } },
  "guest-portal": on,
  waitlist: { enabled: true, config: { mode: "auto" } },
};
const FIELDS = [
  { key: "name", label: "Név", type: "text", required: true, sortOrder: 0 },
  { key: "employee_id", label: "Törzsszám", type: "text", required: true, unique: true, identifier: true, sortOrder: 1 },
  { key: "email", label: "E-mail", type: "email", required: true, sortOrder: 2 },
  { key: "transfer", label: "Transzfer", type: "select", required: true, choices: [{ value: "igen", label: "Igen" }, { value: "nem", label: "Nem" }], sortOrder: 3 },
  { key: "bus", label: "Busz", type: "select", required: true, choicesSource: "bus-transport:routes", showWhen: { fieldKey: "transfer", values: ["igen"] }, sortOrder: 4 },
];
const customer = { name: "Teszt Elek", email: "leader@example.com", phone: "+36301112233", note: "" };

describe("v1: capacity, waitlists and preview mode (Hálózatok Ünnepe)", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let groupId: string;
  let eventId: string;
  let apiKey: string;
  let previewKey: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.DATABASE_URL = mongod.getUri();
    await dbConnect(mongod.getUri());
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
  });

  async function makeEvent(overrides: Record<string, unknown> = {}) {
    // Loosely typed seed data (field defs as plain objects).
    const event = await (EventModel as unknown as { create(doc: object): Promise<{ _id: unknown }> }).create({
      groupId,
      organizationId: orgId,
      name: "MVM Hálózatok Ünnepe 2026",
      status: "active",
      startDate: new Date(Date.now() + 20 * 86_400_000),
      endDate: new Date(Date.now() + 20 * 86_400_000),
      ticketFeeHuf: 0,
      capacity: 1300,
      vouchersEnabled: true,
      attendeeFieldSchemaMode: "replace",
      attendeeFieldSchema: FIELDS,
      modules: MODULES,
      ...overrides,
    });
    return String(event._id);
  }

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
      ].map((m) => (m as unknown as { deleteMany: (q: object) => Promise<unknown> }).deleteMany({})),
    );
    sent.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const org = await OrganizationModel.create({ name: "Eventstructure", slug: "es", status: "active", modules: MODULES });
    orgId = String(org._id);
    apiKey = generateApiKey();
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: hashApiKey(apiKey), apiKeyHint: "tbk_x", apiKeyCreatedAt: new Date() });
    groupId = String(group._id);
    previewKey = (await rotateEventGroupPreviewKey(orgId, groupId)).previewKey;
    eventId = await makeEvent();
    await eventEmails.createEventEmail(orgId, eventId, {
      name: "Visszaigazolás",
      subject: "Visszaigazolás – {{registrationNumber}}",
      body: "<p>Szia {{firstName}}! Transzfer: {{bus.transfer}}</p>",
      trigger: "on_registration",
      audience: "registered",
    });
  });

  // ---- request helpers -----------------------------------------------------------

  const headers = (extra: Record<string, string> = {}) => ({ "X-TBook-Api-Key": apiKey, "Content-Type": "application/json", ...extra });
  const post = async (handler: (request: Request, ctx?: never) => Promise<Response>, path: string, body: unknown, extra: Record<string, string> = {}, ctx?: unknown) => {
    const response = await (handler as (r: Request, c?: unknown) => Promise<Response>)(
      new Request(`https://tbook.test/api/v1/${path}`, { method: "POST", headers: headers(extra), body: JSON.stringify(body) }),
      ctx,
    );
    return { status: response.status, body: (await response.json()) as Json };
  };
  const readEvent = async (id = eventId, extra: Record<string, string> = {}) => {
    const response = await getEvent(new Request(`https://tbook.test/api/v1/events/${id}`, { headers: headers(extra) }), { params: Promise.resolve({ eventId: id }) });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const guest = (id: string, fields: Record<string, string> = {}) => ({ fields: { name: `Vendég ${id}`, employee_id: id, email: `${id}@example.com`, transfer: "nem", ...fields } });
  const book = (attendees: ReturnType<typeof guest>[], extra: Record<string, string> = {}, ev = eventId) =>
    post(postBooking as never, "bookings", { eventId: ev, guests: attendees.length, customer, attendees }, extra);
  const join = (attendees: ReturnType<typeof guest>[], email: string, extra: Record<string, string> = {}, ev = eventId) =>
    post(waitlistJoin as never, "waitlist/join", { eventId: ev, guests: attendees.length, customer: { ...customer, email }, attendees }, extra);
  const status = (code: string, ev = eventId) => post(waitlistStatus as never, "waitlist/status", { eventId: ev, code });
  const sold = async (id = eventId) => (await EventModel.findById(id))!.soldGuestCount;
  const seed = (soldGuestCount: number, id = eventId) => EventModel.updateOne({ _id: id }, { $set: { soldGuestCount } });
  const mailsTo = (to: string) => sent.filter((m) => m.to === to);

  // ---- capacity -------------------------------------------------------------------

  it("fills exactly 1300 places with real bookings; the 1301st is refused and the event reports full", async () => {
    for (let batch = 0; batch < 13; batch += 1) {
      const attendees = Array.from({ length: 100 }, (_, i) => guest(String(100000 + batch * 100 + i)));
      const result = await book(attendees);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.status).toBe("confirmed");
    }
    expect(await sold()).toBe(1300);
    expect(await BookingModel.countDocuments({ status: "confirmed" })).toBe(13);

    const refused = await book([guest("200001")]);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("capacity_full");
    expect(refused.body.error).toMatch(/elfogytak a szabad helyek/);
    expect(await sold()).toBe(1300);

    const { body } = await readEvent();
    expect(body.remainingPlaces).toBe(0);
    expect(body.waitlistOpen).toBe(true);
    expect(body.salesState).toBe("on_sale");
    expect(body.preview).toBeUndefined();
  }, 180_000);

  it("a group of 3 with 2 places left is refused for booking and accepted on the waitlist, with the joined email", async () => {
    await seed(1298);
    expect((await readEvent()).body).toMatchObject({ remainingPlaces: 2, waitlistOpen: false });
    const group = [guest("3001"), guest("3002"), guest("3003")];
    const refused = await book(group);
    expect(refused.body.code).toBe("capacity_full");
    expect(await sold()).toBe(1298);

    const joined = await join(group, "group@example.com");
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body).toMatchObject({ position: 1 });
    expect(joined.body.entryId).toBeTruthy();
    const mail = mailsTo("group@example.com");
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toMatch(/várólistára/);
    expect(mail[0]!.html).toContain("A helyed a sorban: 1");
    expect(mail[0]!.html).toContain(SITE);

    // A single guest still fits.
    expect((await book([guest("3101")])).body.status).toBe("confirmed");
  });

  it("join emails the position; status reports it; leaving moves the others up", async () => {
    await seed(1300);
    const a = await join([guest("4001")], "a@example.com");
    const b = await join([guest("4002")], "b@example.com");
    const c = await join([guest("4003"), guest("4004")], "c@example.com");
    expect([a.body.position, b.body.position, c.body.position]).toEqual([1, 2, 3]);
    expect(mailsTo("b@example.com")[0]!.html).toContain("A helyed a sorban: 2");

    const before = await status("4002");
    expect(before.status).toBe(200);
    expect(before.body.entry).toMatchObject({ status: "waiting", position: 2, guests: 1, names: ["Vendég 4002"], offerExpiresAt: null });
    expect((await status("4004")).body.entry).toMatchObject({ position: 3, guests: 2, names: ["Vendég 4003", "Vendég 4004"] });
    const missing = await status("9999");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatch(/nem találtunk/);

    expect((await post(waitlistLeave as never, "waitlist/leave", { eventId, code: "4001" })).body).toMatchObject({ left: true });
    expect((await status("4001")).status).toBe(404);
    expect((await status("4002")).body.entry.position).toBe(1);
    expect((await status("4003")).body.entry.position).toBe(2);

    // Joining again with the same ID or email is refused.
    expect((await join([guest("4002")], "other@example.com")).body.code).toBe("duplicate");
  });

  it("a cancellation at 1300 promotes the first in line with both emails, tells the canceller, and two concurrent cancellations promote two different entries", async () => {
    await seed(1297);
    expect((await book([guest("5001")])).body.status).toBe("confirmed");
    expect((await book([guest("5002")])).body.status).toBe("confirmed");
    expect((await book([guest("5003")])).body.status).toBe("confirmed");
    expect(await sold()).toBe(1300);
    for (const [id, email] of [
      ["6001", "w1@example.com"],
      ["6002", "w2@example.com"],
      ["6003", "w3@example.com"],
    ] as const) {
      expect((await join([guest(id)], email)).status).toBe(200);
    }
    sent.length = 0;

    const cancelled = await post(guestCancel as never, "guest/cancel", { eventId, code: "5001" });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await sold()).toBe(1300);
    const first = await waitlist.WaitlistEntryModel.findOne({ "customer.email": "w1@example.com" });
    expect(first!.status).toBe("registered");
    const promoted = await BookingModel.findById(first!.bookingId);
    expect(promoted!.status).toBe("confirmed");
    expect(promoted!.attendees[0]!.fields.employee_id).toBe("6001");
    // The promoted guest: the "you're in" note (to the contact) and the normal confirmation (to the attendee).
    expect(mailsTo("w1@example.com").map((m) => m.subject)).toEqual(["Bekerültél! – MVM Hálózatok Ünnepe 2026"]);
    expect(mailsTo("6001@example.com").map((m) => m.subject)).toEqual([`Visszaigazolás – ${promoted!.attendees[0]!.registrationNumber}`]);
    // The canceller.
    const cancelMail = mailsTo("5001@example.com");
    expect(cancelMail).toHaveLength(1);
    expect(cancelMail[0]!.subject).toMatch(/lemondva/);
    expect(cancelMail[0]!.html).toContain(SITE);
    expect((await status("6002")).body.entry.position).toBe(1);

    // Two at once: both remaining entries move up, each exactly once.
    const both = await Promise.all([
      post(guestCancel as never, "guest/cancel", { eventId, code: "5002" }),
      post(guestCancel as never, "guest/cancel", { eventId, code: "5003" }),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    const entries = await waitlist.WaitlistEntryModel.find({}).sort({ createdAt: 1 });
    expect(entries.map((e) => e.status)).toEqual(["registered", "registered", "registered"]);
    const bookingIds = entries.map((e) => String(e.bookingId));
    expect(new Set(bookingIds).size).toBe(3);
    for (const id of ["6001", "6002", "6003"]) {
      expect(await BookingModel.countDocuments({ status: "confirmed", "attendees.fields.employee_id": id })).toBe(1);
    }
    expect(await sold()).toBe(1300);
    expect(await sold()).toBeLessThanOrEqual(1300);
  });

  it("promotion falls back to the bus waitlist when the stored bus has filled up meanwhile", async () => {
    const route = await busTransport.createRoute(orgId, eventId, { code: "B1", city: "Szeged", capacity: 2 });
    const routeId = String(route._id);
    await seed(1299);
    expect((await book([guest("7001")])).body.status).toBe("confirmed");
    expect((await join([guest("7002", { transfer: "igen", bus: routeId })], "bus@example.com")).status).toBe(200);
    // Meanwhile the bus fills up.
    await busTransport.BusRouteModel.updateOne({ _id: routeId }, { $set: { seatsTaken: 2 } });
    sent.length = 0;

    await post(guestCancel as never, "guest/cancel", { eventId, code: "7001" });
    const entry = await waitlist.WaitlistEntryModel.findOne({ "customer.email": "bus@example.com" });
    expect(entry!.status).toBe("registered");
    const booking = await BookingModel.findById(entry!.bookingId);
    expect(booking!.attendees[0]!.fields.bus).toBe("waitlist");
    expect((await busTransport.BusRouteModel.findById(routeId))!.seatsTaken).toBe(2);
    expect(mailsTo("bus@example.com")[0]!.html).toContain("buszos várólistára");
    expect(mailsTo("7002@example.com")[0]!.html).toContain("Várólistán (értesítünk)");
    expect((await busTransport.listBusWaitlist(eventId)).map((r) => r.name)).toEqual(["Vendég 7002"]);
  });

  it("bus waitlist: a full bus offers “notify me”, holds no seat, emails once when a seat frees up, and the guest then picks the bus", async () => {
    const routeId = String((await busTransport.createRoute(orgId, eventId, { code: "B1", city: "Pécs", capacity: 1 }))._id);
    expect((await book([guest("8001", { transfer: "igen", bus: routeId })])).body.status).toBe("confirmed");

    const { body } = await readEvent();
    const busField = body.event.attendeeFieldSchema.find((f: { key: string }) => f.key === "bus");
    expect(busField.choices.map((c: { value: string }) => c.value)).toEqual(["waitlist"]); // the full bus isn't selectable
    expect(body.event.fieldChoiceDetails.bus.at(-1)).toEqual({
      value: "waitlist",
      label: "Nincs szabad hely – értesítést kérek, ha felszabadul",
      remaining: null,
      disabled: false,
      meta: { waitlist: true },
    });
    expect(body.event.fieldChoiceDetails.bus[0]).toMatchObject({ value: routeId, remaining: 0, disabled: true });

    expect((await book([guest("8002", { transfer: "igen", bus: "waitlist" })])).body.status).toBe("confirmed");
    expect((await book([guest("8003", { transfer: "igen", bus: "waitlist" })])).body.status).toBe("confirmed");
    expect((await busTransport.BusRouteModel.findById(routeId))!.seatsTaken).toBe(1);
    const lookup = await post(guestLookup as never, "guest/lookup", { eventId, code: "8002" });
    expect(lookup.body.guest).toMatchObject({ bus: null, busWaitlist: { position: 1 } });
    expect((await post(guestLookup as never, "guest/lookup", { eventId, code: "8003" })).body.guest.busWaitlist).toEqual({ position: 2 });
    expect((await post(guestLookup as never, "guest/lookup", { eventId, code: "8001" })).body.guest.busWaitlist).toBeNull();
    expect((await busTransport.listPassengers((await busTransport.BusRouteModel.findById(routeId))!)).map((p) => p.name)).toEqual(["Vendég 8001"]);
    expect(sent.filter((m) => /Felszabadult hely a buszon/.test(m.subject))).toHaveLength(0);

    sent.length = 0;
    await post(guestCancel as never, "guest/cancel", { eventId, code: "8001" });
    const notices = sent.filter((m) => /Felszabadult hely a buszon/.test(m.subject));
    expect(notices.map((m) => m.to).sort()).toEqual(["8002@example.com", "8003@example.com"]);
    expect(notices[0]!.html).toContain(SITE);
    // Another trigger without new seats doesn't email again.
    await busTransport.recountSeats(orgId, eventId);
    expect(await busTransport.notifyBusWaitlist(eventId)).toBe(0);
    expect(sent.filter((m) => /Felszabadult hely a buszon/.test(m.subject))).toHaveLength(2);

    const switched = await post(guestUpdate as never, "guest/update", { eventId, code: "8002", fields: { bus: routeId } });
    expect(switched.status, JSON.stringify(switched.body)).toBe(200);
    expect(switched.body.guest).toMatchObject({ bus: { code: "B1" }, busWaitlist: null });
    expect((await busTransport.BusRouteModel.findById(routeId))!.seatsTaken).toBe(1);
    expect((await post(guestLookup as never, "guest/lookup", { eventId, code: "8003" })).body.guest.busWaitlist).toEqual({ position: 1 });
    // The bus is full again: the other guest can't take it.
    expect((await post(guestUpdate as never, "guest/update", { eventId, code: "8003", fields: { bus: routeId } })).body.code).toBe("bus_full");
  });

  it("preview mode: a draft event is readable with the key, a preview booking or waitlist join saves and sends nothing, and a wrong key is no preview", async () => {
    await EventModel.updateOne({ _id: eventId }, { $set: { status: "draft", salesOpensAt: new Date(Date.now() + 86_400_000) } });
    expect((await readEvent()).status).toBe(404);
    expect((await readEvent(eventId, { "X-TBook-Preview": "tbp_wrong_key_123456789" })).status).toBe(404);
    const preview = await readEvent(eventId, { "X-TBook-Preview": previewKey });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ preview: true, salesState: "not_started", remainingPlaces: 1300 });

    const result = await book([guest("9001"), guest("9002")], { "X-TBook-Preview": previewKey });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ preview: true, status: "confirmed", bookingId: null });
    expect(result.body.registrationNumber).toMatch(/^PREVIEW-[0-9A-F]{4}$/);
    expect(await BookingModel.countDocuments({})).toBe(0);
    expect(await FieldClaimModel.countDocuments({})).toBe(0);
    expect(await sold()).toBe(0);
    expect(sent).toHaveLength(0);

    // Every check still runs.
    const invalid = await book([{ fields: { name: "X", employee_id: "9003", email: "x@example.com" } } as never], { "X-TBook-Preview": previewKey });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatch(/Transzfer/);
    const routeId = String((await busTransport.createRoute(orgId, eventId, { code: "B1", city: "Pécs", capacity: 1 }))._id);
    await busTransport.BusRouteModel.updateOne({ _id: routeId }, { $set: { capacity: 0 } });
    // A full bus isn't a live choice; "waitlist" is.
    expect((await book([guest("9004", { transfer: "igen", bus: routeId })], { "X-TBook-Preview": previewKey })).status).toBe(400);
    expect((await book([guest("9004", { transfer: "igen", bus: "waitlist" })], { "X-TBook-Preview": previewKey })).body.preview).toBe(true);
    expect(await busTransport.BusWaitlistEntryModel.countDocuments({})).toBe(0);

    // Without the key (or with a wrong one) the draft is closed.
    expect((await book([guest("9005")])).status).toBe(404);
    expect((await book([guest("9005")], { "X-TBook-Preview": "tbp_wrong_key_123456789" })).status).toBe(404);

    // Waitlist preview: full event, the would-be position, nothing stored or sent.
    await seed(1300);
    await EventModel.updateOne({ _id: eventId }, { $set: { status: "active", salesOpensAt: null } });
    expect((await join([guest("9101")], "real@example.com")).body.position).toBe(1);
    sent.length = 0;
    const joined = await join([guest("9102")], "p@example.com", { "X-TBook-Preview": previewKey });
    expect(joined.body).toMatchObject({ preview: true, entryId: null, position: 2 });
    expect(await waitlist.WaitlistEntryModel.countDocuments({})).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("a waitlisted ID can't also book; the ID-first prefill says it's on the waitlist (also in preview on a draft)", async () => {
    const { list } = await createDataList(
      orgId,
      { name: "Staff", keyColumn: "ID", keyNormalization: "digits_only", columns: ["ID", "Név"].map((key) => ({ key, label: key })) },
      [
        { ID: "1001", Név: "Lista Lili" },
        { ID: "1002", Név: "Lista Laci" },
      ],
    );
    const prefilled = await makeEvent({
      name: "Prefill",
      capacity: 1,
      attendeeFieldSchema: FIELDS.map((f) => (f.key === "name" ? { ...f, prefillColumn: "Név" } : f)),
      eligibilityPreset: "form_rules",
      eligibilityFormRules: { logic: "and", rules: [{ id: "r1", fieldKey: "employee_id", op: "in_list", value: String(list._id), message: "Ismeretlen törzsszám." }] },
    });
    const ctx = { params: Promise.resolve({ eventId: prefilled }) };
    const ask = (code: string, extra: Record<string, string> = {}) => post(prefill as never, `events/${prefilled}/prefill`, { code }, extra, ctx);

    expect((await book([guest("1001")], {}, prefilled)).body.status).toBe("confirmed");
    expect((await join([guest("1002")], "laci@example.com", {}, prefilled)).status).toBe(200);
    expect((await ask("1002")).body).toEqual({ ok: true, found: true, alreadyRegistered: false, onWaitlist: true, fields: {} });
    expect((await ask("1001")).body).toMatchObject({ found: true, alreadyRegistered: true });

    // A place frees up without the waitlist moving (say, the organizer raised the cap): the waitlisted ID still can't book.
    await EventModel.updateOne({ _id: prefilled }, { $set: { capacity: 5 } });
    const refused = await book([guest("1002")], {}, prefilled);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("on_waitlist");
    expect(refused.body.error).toMatch(/már várólistán vagy/);
    expect(await BookingModel.countDocuments({ "attendees.fields.employee_id": "1002" })).toBe(0);

    await EventModel.updateOne({ _id: prefilled }, { $set: { status: "draft" } });
    expect((await ask("1002")).status).toBe(404);
    expect((await ask("1002", { "X-TBook-Preview": previewKey })).body).toMatchObject({ onWaitlist: true });
  });
});
