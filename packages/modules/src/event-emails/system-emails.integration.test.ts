import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventGroupModel, EventModel, FieldClaimModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { cancelBookingAttendee, createBookingWithCheckout, createTestBookingWithCheckout, resolveModules } from "@tbook/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "../index";
import { systemEmailDefault } from "../system-email-defaults";
import { BusRouteModel, BusWaitlistEntryModel } from "../bus-transport/model";
import { createRoute } from "../bus-transport/service";
import { setModuleMailTransporter } from "../shared/mail";
import { WaitlistEntryModel } from "../waitlist/model";
import { joinWaitlist, setWaitlistTransporter } from "../waitlist/service";
import { EmailDeliveryModel, EventEmailModel } from "./model";
import { createEventEmail, setEventEmailTransporter, updateEventEmail } from "./service";

/**
 * System emails: a module's guest message uses the event's email of that
 * trigger when there is one (active → sent, off → nothing), else the
 * module settings text, else the built-in text. "[TESZT] " stays.
 */

const sent: Array<{ to: string; subject: string; html: string }> = [];
const transporter = {
  sendMail: async (message: { to: string; subject: string; html: string }) => {
    sent.push(message);
    return {} as never;
  },
};
const customer = { name: "Teszt Elek", email: "teszt@example.com", phone: "+36301112233", note: "" };
const on = { enabled: true };
const ALL = { "free-registration": on, "bus-transport": on, "event-emails": on, "guest-portal": on, waitlist: on };

describe("system emails", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let groupId: string;
  let eventId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
    process.env.EMAIL_HOST = "smtp.test.invalid";
    process.env.EMAIL_USER = "noreply@test.invalid";
    process.env.EMAIL_PASS = "x";
    setEventEmailTransporter(transporter as never);
    setWaitlistTransporter(transporter as never);
    setModuleMailTransporter(transporter as never);
  });
  afterAll(async () => {
    setEventEmailTransporter(undefined);
    setWaitlistTransporter(undefined);
    setModuleMailTransporter(undefined);
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all(
      [BookingModel, EventModel, EventGroupModel, OrganizationModel, VoucherModel, FieldClaimModel, BusRouteModel, BusWaitlistEntryModel, EventEmailModel, EmailDeliveryModel, WaitlistEntryModel].map((m) =>
        (m as unknown as { deleteMany: (q: object) => Promise<unknown> }).deleteMany({}),
      ),
    );
    sent.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const org = await OrganizationModel.create({ name: "ES", slug: "es", status: "active", modules: ALL });
    orgId = String(org._id);
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: "h", apiKeyHint: "x", apiKeyCreatedAt: new Date() });
    groupId = String(group._id);
    const event = await EventModel.create({
      groupId,
      organizationId: orgId,
      name: "Ünnep",
      status: "active",
      startDate: new Date(Date.now() + 20 * 86_400_000),
      endDate: new Date(Date.now() + 20 * 86_400_000),
      ticketFeeHuf: 0,
      capacity: 1,
      vouchersEnabled: true,
      attendeeFieldSchemaMode: "replace",
      attendeeFieldSchema: [
        { key: "name", label: "Név", type: "text", required: true, sortOrder: 0 },
        { key: "employee_id", label: "Törzsszám", type: "text", required: true, unique: true, identifier: true, sortOrder: 1 },
        { key: "email", label: "E-mail", type: "email", required: false, sortOrder: 2 },
        { key: "transfer", label: "Transzfer", type: "select", required: true, choices: [{ value: "igen", label: "Igen" }, { value: "nem", label: "Nem" }], sortOrder: 3 },
        { key: "bus", label: "Busz", type: "select", required: true, choicesSource: "bus-transport:routes", showWhen: { fieldKey: "transfer", values: ["igen"] }, sortOrder: 4 },
      ],
      modules: { ...ALL, "event-emails": { enabled: true, config: { siteUrl: "https://ünnep.example.hu" } }, waitlist: { enabled: true, config: { mode: "auto" } } },
    });
    eventId = String(event._id);
  });

  const guest = (id: string, fields: Record<string, string> = {}) => ({ fields: { name: `Vendég ${id}`, employee_id: id, email: `${id}@example.com`, transfer: "nem", ...fields } });
  const register = (attendees: ReturnType<typeof guest>[]) => createBookingWithCheckout({ eventId, guests: attendees.length, customer, attendees }, { groupId });
  const join = (id: string, test = false) =>
    joinWaitlist(eventId, { customer: { name: `Várakozó ${id}`, email: `w${id}@example.com`, phone: "+36301" }, attendees: [guest(id)] }, groupId, test ? { test: true } : {});
  const system = (trigger: string, subject: string, body: string, active = true) =>
    createEventEmail(orgId, eventId, { name: trigger, subject, body, trigger: trigger as never, audience: "registered", active });

  it("waitlist joined: built-in text without a template, the template when active, nothing when off", async () => {
    await register([guest("1001")]);
    await join("2001");
    expect(sent.map((m) => m.subject)).toEqual(["Felkerültél a várólistára – Ünnep"]);

    sent.length = 0;
    const email = await system("waitlist_joined", "Várólista – {{event}}", "<p>Szia {{firstName}}! Helyed: {{position}}. Törzsszám: {{field.employee_id}}. <a href=\"{{siteUrl}}/fiokom.php\">belépés</a></p>");
    await join("2002");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "w2002@example.com", subject: "Várólista – Ünnep" });
    expect(sent[0]!.html).toContain("Szia 2002! Helyed: 2. Törzsszám: 2002.");
    expect(sent[0]!.html).toContain("https://ünnep.example.hu/fiokom.php");
    expect(await EmailDeliveryModel.countDocuments({ emailId: email._id, status: "sent" })).toBe(1);

    sent.length = 0;
    await updateEventEmail(orgId, String(email._id), { name: email.name, subject: email.subject, body: email.body, trigger: "waitlist_joined", audience: "registered", active: false });
    await join("2003");
    expect(sent).toHaveLength(0);
  });

  it("the module settings text still wins over the built-in one when there is no template", async () => {
    await EventModel.updateOne({ _id: eventId }, { $set: { "modules.waitlist.config.joinedSubject": "Régi tárgy – {{event}}" } });
    await register([guest("1001")]);
    await join("2001");
    expect(sent.map((m) => m.subject)).toEqual(["Régi tárgy – Ünnep"]);
    const event = (await EventModel.findById(eventId))!;
    const fallback = systemEmailDefault("waitlist_joined", await resolveModules({ organizationId: orgId, event }));
    expect(fallback).toMatchObject({ subject: "Régi tárgy – {{event}}", source: "module_settings" });
    expect(fallback.body).toContain('<a href="{{siteUrl}}">{{siteUrl}}</a>');
  });

  it("a test entry's system email keeps the [TESZT] prefix", async () => {
    await system("waitlist_joined", "Várólista – {{event}}", "<p>{{position}}</p>");
    await join("3001", true);
    expect(sent.map((m) => m.subject)).toEqual(["[TESZT] Várólista – Ünnep"]);
  });

  it("waitlist registered and cancellation: templates per attendee, registration number filled, off = silent", async () => {
    await system("waitlist_registered", "Bekerültél – {{eventName}}", "<p>{{name}}: {{registrationNumber}}</p><p>{{busNote}}</p>");
    await system("booking_cancelled", "Lemondva – {{eventName}}", "<p>{{firstName}} {{registrationNumber}} {{qrCode}}</p>");
    const first = await register([guest("1001")]);
    await join("2001");
    sent.length = 0;
    await cancelBookingAttendee(first.bookingId, 0, { by: "guest" });

    const cancelled = sent.find((m) => m.subject === "Lemondva – Ünnep")!;
    expect(cancelled.to).toBe("1001@example.com");
    const number = (await BookingModel.findById(first.bookingId))!.cancelledAttendees[0]!.attendee.registrationNumber!;
    expect(cancelled.html).toContain(number);
    expect(cancelled.html).not.toContain("<img");
    expect(sent.some((m) => /Regisztráció lemondva/.test(m.subject))).toBe(false); // not the built-in one

    const entry = (await WaitlistEntryModel.findOne({ "customer.email": "w2001@example.com" }))!;
    expect(entry.status).toBe("registered");
    const promoted = (await BookingModel.findById(entry.bookingId))!;
    const registered = sent.find((m) => m.subject === "Bekerültél – Ünnep")!;
    expect(registered.to).toBe("w2001@example.com");
    expect(registered.html).toContain(`Várakozó 2001: ${promoted.registrationNumber}`);
    expect(promoted.registrationNumber).toBeTruthy();
    expect(registered.html).not.toContain("<p></p>");

    // Switched off: the promoted guest's cancellation sends nothing.
    await EventEmailModel.updateOne({ trigger: "booking_cancelled" }, { $set: { active: false } });
    sent.length = 0;
    await cancelBookingAttendee(String(promoted._id), 0, { by: "admin:u1" });
    expect(sent.filter((m) => /lemond/i.test(m.subject))).toHaveLength(0);
  });

  it("cancellation without a template: the built-in text, [TESZT] for a test booking", async () => {
    const test = await createTestBookingWithCheckout({ eventId, guests: 1, customer, attendees: [guest("5001")] }, { groupId });
    sent.length = 0;
    await cancelBookingAttendee(test.bookingId, 0, { by: "guest" });
    expect(sent.map((m) => m.subject)).toContain("[TESZT] Regisztráció lemondva – Ünnep");
  });

  it("bus seat freed: the template goes to each waiting guest; off = nobody", async () => {
    await EventModel.updateOne({ _id: eventId }, { $set: { capacity: 10 } });
    const route = String((await createRoute(orgId, eventId, { code: "A", city: "Szeged", capacity: 1 }))._id);
    const seated = await register([guest("1001", { transfer: "igen", bus: route })]);
    await register([guest("1002", { transfer: "igen", bus: "waitlist" })]);
    await system("bus_seat_freed", "Busz – {{event}}", "<p>Szia {{firstName}} ({{field.employee_id}})! {{siteUrl}}</p>");
    sent.length = 0;
    await cancelBookingAttendee(seated.bookingId, 0, { by: "guest" });
    const notices = sent.filter((m) => m.subject === "Busz – Ünnep");
    expect(notices.map((m) => m.to)).toEqual(["1002@example.com"]);
    expect(notices[0]!.html).toContain("Szia 1002 (1002)!");
  });

  it("bus seat freed switched off: nobody is emailed", async () => {
    await EventModel.updateOne({ _id: eventId }, { $set: { capacity: 10 } });
    const route = String((await createRoute(orgId, eventId, { code: "A", city: "Szeged", capacity: 1 }))._id);
    const seated = await register([guest("1001", { transfer: "igen", bus: route })]);
    await register([guest("1002", { transfer: "igen", bus: "waitlist" })]);
    await system("bus_seat_freed", "Busz – {{event}}", "<p>x</p>", false);
    sent.length = 0;
    await cancelBookingAttendee(seated.bookingId, 0, { by: "guest" });
    expect(sent.filter((m) => /busz/i.test(m.subject))).toHaveLength(0);
  });

  it("one email per system trigger and event", async () => {
    await system("bus_seat_freed", "A", "<p>a</p>");
    await expect(system("bus_seat_freed", "B", "<p>b</p>")).rejects.toThrow(/already has/);
  });
});
