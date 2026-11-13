import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventGroupModel, EventModel, FieldClaimModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { busTransport, eventEmails, setModuleMailTransporter, waitlist } from "@tbook/modules";
import { generateApiKey, hashApiKey, rotateEventGroupPreviewKey, updateBookingDetails } from "@tbook/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getEvent } from "./events/[eventId]/route";
import { POST as postBooking } from "./bookings/route";
import { POST as guestCancel } from "./guest/cancel/route";
import { POST as guestLookup } from "./guest/lookup/route";
import { POST as guestUpdate } from "./guest/update/route";
import { POST as waitlistJoin } from "./waitlist/join/route";

/**
 * The two bus states of the Hálózatok Ünnepe site, switched by the
 * organizer from the Buses page without development:
 *  1. no active bus ("bus booking not open yet"): guests only say transfer
 *     yes/no, the bus question offers nothing and may stay empty;
 *  2. buses active: the bus is chosen at registration as before, and guests
 *     from state 1 add theirs to the existing registration (guest update),
 *     which sends the bus email only.
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
  "event-emails": { enabled: true, config: { siteUrl: "https://example.hu" } },
  "guest-portal": on,
  waitlist: { enabled: true, config: { mode: "auto" } },
};
const FIELDS = [
  { key: "name", label: "Név", type: "text", required: true, sortOrder: 0 },
  { key: "employee_id", label: "Törzsszám", type: "text", required: true, unique: true, identifier: true, sortOrder: 1 },
  { key: "email", label: "E-mail", type: "email", required: true, sortOrder: 2 },
  { key: "transzfer", label: "Transzfer", type: "select", required: true, choices: [{ value: "igen", label: "Igen" }, { value: "nem", label: "Nem" }], sortOrder: 3 },
  { key: "busz", label: "Busz", type: "select", required: true, choicesSource: "bus-transport:routes", showWhen: { fieldKey: "transzfer", values: ["igen"] }, sortOrder: 4 },
  { key: "diet", label: "Étkezés", type: "select", required: false, choices: [{ value: "normal", label: "Normál" }, { value: "veg", label: "Vegetáriánus" }], sortOrder: 5 },
];
const customer = { name: "Teszt Elek", email: "leader@example.com", phone: "+36301112233", note: "" };
const BUS_BOOKED = {
  logic: "and" as const,
  rules: [
    { id: "c1", fieldKey: "busz", op: "is_not_empty" as const, value: "" },
    { id: "c2", fieldKey: "busz", op: "not_equals" as const, value: "waitlist" },
  ],
};
const AWAITING_BUS = {
  logic: "and" as const,
  rules: [
    { id: "c1", fieldKey: "transzfer", op: "equals" as const, value: "igen" },
    { id: "c2", fieldKey: "busz", op: "is_empty" as const, value: "" },
  ],
};

describe("v1: two bus states (no buses yet / bus booking open)", () => {
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

  beforeEach(async () => {
    await Promise.all(
      [
        BookingModel,
        EventModel,
        EventGroupModel,
        OrganizationModel,
        VoucherModel,
        FieldClaimModel,
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
    });
    eventId = String(event._id);
    await eventEmails.createEventEmail(orgId, eventId, {
      name: "Visszaigazolás",
      subject: "Visszaigazolás",
      body: "<p>Szia {{firstName}}! Transzfer: {{bus.transfer}}</p>",
      trigger: "on_registration",
      audience: "registered",
    });
    await eventEmails.createEventEmail(orgId, eventId, {
      name: "Busz",
      subject: "Buszod",
      body: "<p>{{bus.code}} – kapitány: {{bus.captainName}} {{bus.captainPhone}} ({{bus.transfer}})</p>",
      trigger: "on_registration",
      audience: "registered",
      conditions: BUS_BOOKED,
    });
  });

  const headers = (extra: Record<string, string> = {}) => ({ "X-TBook-Api-Key": apiKey, "Content-Type": "application/json", ...extra });
  const post = async (handler: unknown, path: string, body: unknown, extra: Record<string, string> = {}) => {
    const response = await (handler as (r: Request) => Promise<Response>)(
      new Request(`https://tbook.test/api/v1/${path}`, { method: "POST", headers: headers(extra), body: JSON.stringify(body) }),
    );
    return { status: response.status, body: (await response.json()) as Json };
  };
  const readEvent = async () => {
    const response = await getEvent(new Request(`https://tbook.test/api/v1/events/${eventId}`, { headers: headers() }), { params: Promise.resolve({ eventId }) });
    return (await response.json()) as Json;
  };
  const guest = (id: string, fields: Record<string, string> = {}) => ({ fields: { name: `Vendég ${id}`, employee_id: id, email: `${id}@example.com`, transzfer: "nem", ...fields } });
  const book = (attendees: ReturnType<typeof guest>[], extra: Record<string, string> = {}) =>
    post(postBooking, "bookings", { eventId, guests: attendees.length, customer, attendees }, extra);
  const update = (code: string, fields: Record<string, string>) => post(guestUpdate, "guest/update", { eventId, code, fields });
  const subjectsTo = (to: string) => sent.filter((m) => m.to === to).map((m) => m.subject);
  const openBuses = async () => {
    const a = await busTransport.createRoute(orgId, eventId, { code: "B01", city: "Szeged", capacity: 1, captainName: "Kapitány Kázmér", captainPhone: "+36 30 000 0000" });
    const b = await busTransport.createRoute(orgId, eventId, { code: "B02", city: "Pécs", capacity: 5, captainName: "Nagy Anna", captainPhone: "+36 30 111 1111" });
    return { busA: String(a._id), busB: String(b._id) };
  };

  it("state 1 (no active bus): the bus question is optional and offers nothing, at booking, preview, test and waitlist join", async () => {
    // An inactive bus doesn't open bus booking.
    const draft = await busTransport.createRoute(orgId, eventId, { code: "B09", city: "Győr", capacity: 10, active: false });
    const { event } = await readEvent();
    const bus = event.attendeeFieldSchema.find((f: { key: string }) => f.key === "busz");
    expect(bus).toMatchObject({ required: false, choices: [] });
    expect(event.fieldChoiceDetails.busz).toEqual([]);

    const booked = await book([guest("1001", { transzfer: "igen" }), guest("1002")]);
    expect(booked.status, JSON.stringify(booked.body)).toBe(200);
    expect(booked.body.status).toBe("confirmed");
    const stored = (await BookingModel.findById(booked.body.bookingId))!;
    expect(stored.attendees[0]!.fields.busz).toBeUndefined();
    // The booking keeps the organizer's "required" for later edits.
    expect(stored.attendeeFieldSchema.find((f) => f.key === "busz")?.required).toBe(true);

    // "waitlist" means nothing without buses: refused like any answer not offered.
    expect((await book([guest("1003", { transzfer: "igen", busz: "waitlist" })])).status).toBe(400);
    expect((await book([guest("1003", { transzfer: "igen", busz: String(draft._id) })])).status).toBe(400);

    const preview = await book([guest("1004", { transzfer: "igen" })], { "X-TBook-Preview": previewKey });
    expect(preview.body).toMatchObject({ preview: true, status: "confirmed" });
    const test = await book([guest("1005", { transzfer: "igen" })], { "X-TBook-Preview": previewKey, "X-TBook-Test": "1" });
    expect(test.status, JSON.stringify(test.body)).toBe(200);
    expect(test.body.test).toBe(true);

    await EventModel.updateOne({ _id: eventId }, { $set: { soldGuestCount: 1300 } });
    const joined = await post(waitlistJoin, "waitlist/join", { eventId, guests: 1, customer: { ...customer, email: "w@example.com" }, attendees: [guest("1006", { transzfer: "igen" })] });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);

    // Only the general confirmation, with the "requested, no bus yet" transfer text.
    expect(subjectsTo("1001@example.com")).toEqual(["Visszaigazolás"]);
    expect(sent.find((m) => m.to === "1001@example.com")!.html).toContain("Igényelt (járat még nincs kiválasztva)");
    expect(sent.find((m) => m.to === "1002@example.com")!.html).toContain("Nem igényelt");
    expect(sent.some((m) => m.subject.includes("Buszod"))).toBe(false);
  });

  it("state 2: activating a bus makes it required again; a state-1 guest adds a bus and gets only the bus email; A → B re-sends it", async () => {
    const early = await book([guest("2001", { transzfer: "igen" }), guest("2002", { transzfer: "igen" })]);
    const numberBefore = (await BookingModel.findById(early.body.bookingId))!.attendees[0]!.registrationNumber;
    const vouchersBefore = (await VoucherModel.find({ bookingId: early.body.bookingId }).lean()).map((v) => v.token).sort();
    expect(subjectsTo("2001@example.com")).toEqual(["Visszaigazolás"]);

    const { busA, busB } = await openBuses();
    const { event } = await readEvent();
    const bus = event.attendeeFieldSchema.find((f: { key: string }) => f.key === "busz");
    expect(bus.required).toBe(true);
    expect(bus.choices.map((c: { value: string }) => c.value)).toEqual([busB, busA, "waitlist"]); // by city
    expect((await book([guest("2003", { transzfer: "igen" })])).status).toBe(400);
    expect((await book([guest("2003", { transzfer: "igen", busz: busB })])).body.status).toBe("confirmed");
    expect(subjectsTo("2003@example.com")).toEqual(["Visszaigazolás", "Buszod"]);

    // Once buses are open, a guest who wants a transfer picks one with their next change.
    expect((await update("2002", { diet: "veg" })).body.error).toMatch(/Busz \(kötelező\)/);

    sent.length = 0;
    // The other guest of the group hasn't picked yet: that doesn't block this change.
    const picked = await update("2001", { busz: busA });
    expect(picked.status, JSON.stringify(picked.body)).toBe(200);
    expect(picked.body.guest).toMatchObject({ registrationNumber: numberBefore, bus: { code: "B01", captainName: "Kapitány Kázmér" } });
    expect((await busTransport.BusRouteModel.findById(busA))!.seatsTaken).toBe(1);
    expect((await VoucherModel.find({ bookingId: early.body.bookingId }).lean()).map((v) => v.token).sort()).toEqual(vouchersBefore);
    expect(sent.map((m) => [m.to, m.subject])).toEqual([["2001@example.com", "Buszod"]]);
    expect(sent[0]!.html).toContain("Kapitány Kázmér +36 30 000 0000 (Foglalt)");

    // Switching buses moves the seat and sends the bus email again (with the new captain).
    sent.length = 0;
    expect((await update("2001", { busz: busB })).status).toBe(200);
    expect((await busTransport.BusRouteModel.findById(busA))!.seatsTaken).toBe(0);
    expect((await busTransport.BusRouteModel.findById(busB))!.seatsTaken).toBe(2);
    expect(sent.map((m) => m.subject)).toEqual(["Buszod"]);
    expect(sent[0]!.html).toContain("Nagy Anna");

    // An answer no condition looks at sends nothing; a new address re-sends what matches.
    sent.length = 0;
    expect((await update("2001", { diet: "veg" })).status).toBe(200);
    expect(sent).toHaveLength(0);
    expect((await update("2001", { email: "new2001@example.com" })).status).toBe(200);
    expect(sent.map((m) => [m.to, m.subject]).sort()).toEqual([
      ["new2001@example.com", "Buszod"],
      ["new2001@example.com", "Visszaigazolás"],
    ]);

    // The bus waitlist: the full bus A offers "notify me"; the email text says so and no bus email goes out.
    sent.length = 0;
    expect((await update("2002", { busz: busA })).status).toBe(200);
    expect((await update("2001", { busz: busA })).body.code).toBe("bus_full");
    expect((await update("2001", { busz: "waitlist" })).status).toBe(200);
    expect(sent.filter((m) => ["Buszod", "Visszaigazolás"].includes(m.subject)).map((m) => m.to)).toEqual(["2002@example.com"]);
  });

  it("an organizer edit that adds a bus sends the bus email too; the admin resend still sends everything", async () => {
    const early = await book([guest("3001", { transzfer: "igen" })]);
    const { busB } = await openBuses();
    sent.length = 0;
    const booking = (await BookingModel.findById(early.body.bookingId))!;
    await updateBookingDetails(orgId, early.body.bookingId, { attendees: [{ fields: { ...booking.attendees[0]!.fields, busz: busB } }], editedBy: "u1" });
    expect(sent.map((m) => m.subject)).toEqual(["Buszod"]);

    sent.length = 0;
    await eventEmails.resendAutomaticEmails(orgId, (await BookingModel.findById(early.body.bookingId))!);
    expect(sent.map((m) => m.subject).sort()).toEqual(["Buszod", "Visszaigazolás"]);
  });

  it("{{bus.transfer}}: Foglalt / Várólistán (értesítünk) / Igényelt (járat még nincs kiválasztva) / Nem igényelt", async () => {
    const early = await book([guest("4001", { transzfer: "igen" }), guest("4002")]);
    const { busA } = await openBuses();
    const later = await book([guest("4003", { transzfer: "igen", busz: busA }), guest("4004", { transzfer: "igen", busz: "waitlist" })]);
    const transfer = async (bookingId: string, index: number) => {
      const booking = (await BookingModel.findById(bookingId))!;
      const html = sent.filter((m) => m.subject === "Visszaigazolás" && m.to === `${booking.attendees[index]!.fields.employee_id}@example.com`).at(-1)!.html;
      return /Transzfer: ([^<]+)</.exec(html)![1];
    };
    expect(await transfer(early.body.bookingId, 0)).toBe("Igényelt (járat még nincs kiválasztva)");
    expect(await transfer(early.body.bookingId, 1)).toBe("Nem igényelt");
    expect(await transfer(later.body.bookingId, 0)).toBe("Foglalt");
    expect(await transfer(later.body.bookingId, 1)).toBe("Várólistán (értesítünk)");
  });

  it("a manual email with conditions reaches every matching attendee of a group on one shared address, each with their own data", async () => {
    const shared = "csoport@example.com";
    const group = await book([
      guest("5001", { email: shared, transzfer: "igen" }),
      guest("5002", { email: shared, transzfer: "igen" }),
      guest("5003", { email: shared }),
    ]);
    expect(group.status).toBe(200);
    const manual = await eventEmails.createEventEmail(orgId, eventId, {
      name: "Busz hamarosan",
      subject: "Válassz buszt",
      body: "<p>{{fullName}} – {{registrationNumber}} – {{bus.transfer}}</p>",
      trigger: "manual",
      audience: "registered",
      conditions: AWAITING_BUS,
    });
    sent.length = 0;
    await eventEmails.startEventEmailSend(orgId, String(manual._id), null, { wait: true, transporter: transporter as never });
    const booking = (await BookingModel.findById(group.body.bookingId))!;
    expect(sent.map((m) => m.to)).toEqual([shared, shared]);
    expect(sent[0]!.html).toContain(`Vendég 5001 – ${booking.attendees[0]!.registrationNumber} – Igényelt (járat még nincs kiválasztva)`);
    expect(sent[1]!.html).toContain(`Vendég 5002 – ${booking.attendees[1]!.registrationNumber}`);
    expect(await eventEmails.countEmailRecipients(orgId, String(manual._id))).toBe(2);
  });

  it("refuses an unknown condition op instead of matching everyone", async () => {
    await expect(
      eventEmails.createEventEmail(orgId, eventId, {
        name: "X",
        subject: "X",
        body: "x",
        trigger: "on_registration",
        audience: "registered",
        conditions: { logic: "and", rules: [{ id: "c1", fieldKey: "busz", op: "empty" as never, value: "" }] },
      }),
    ).rejects.toThrow(/Unknown condition/);
  });

  it("a waitlist entry from state 1 is promoted in state 2 onto the bus waitlist (never refused for the missing bus)", async () => {
    await EventModel.updateOne({ _id: eventId }, { $set: { soldGuestCount: 1299 } });
    const first = await book([guest("6001")]);
    expect(first.body.status).toBe("confirmed");
    expect((await post(waitlistJoin, "waitlist/join", { eventId, guests: 1, customer: { ...customer, email: "w@example.com" }, attendees: [guest("6002", { transzfer: "igen" })] })).status).toBe(200);
    await openBuses();
    await post(guestCancel, "guest/cancel", { eventId, code: "6001" });
    const entry = await waitlist.WaitlistEntryModel.findOne({ "customer.email": "w@example.com" });
    expect(entry!.status).toBe("registered");
    const promoted = (await BookingModel.findById(entry!.bookingId))!;
    expect(promoted.attendees[0]!.fields.busz).toBe("waitlist");
    expect((await post(guestLookup, "guest/lookup", { eventId, code: "6002" })).body.guest.busWaitlist).toEqual({ position: 1 });
  });
});
