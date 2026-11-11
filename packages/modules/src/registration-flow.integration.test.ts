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
import { cancelBooking, createBookingWithCheckout, createDataList } from "@tbook/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "./index";
import { BusBoardingModel, BusRouteModel } from "./bus-transport/model";
import { createRoute, findRouteByCaptainToken, legCounts, listPassengers, rotateCaptainToken, setBoarding } from "./bus-transport/service";
import { EmailDeliveryModel, EventEmailModel } from "./event-emails/model";
import { createEventEmail, setEventEmailTransporter, startEventEmailSend } from "./event-emails/service";

/**
 * The Hálózatok Ünnepe setup end to end, built only from configuration:
 * an employee-ID field checked against an uploaded list (`in_list`) and
 * unique per event, a conditional bus select fed by the bus module, free
 * registration, and per-attendee emails.
 */

const sent: Array<{ to: string; subject: string; html: string; attachments?: Array<{ cid?: string }> }> = [];
const transporter = {
  sendMail: async (message: { to: string; subject: string; html: string; attachments?: Array<{ cid?: string }> }) => {
    sent.push(message);
    return {} as never;
  },
};

const customer = { name: "Szőke Tibor", email: "szoke.tibor@mvm.hu", phone: "+36301112233", note: "" };

describe("configured free registration with ID list, bus seats and event emails", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let groupId: string;
  let eventId: string;
  let listId: string;
  let routeId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
    process.env.EMAIL_HOST = "smtp.test.invalid";
    process.env.EMAIL_USER = "noreply@test.invalid";
    process.env.EMAIL_PASS = "x";
    setEventEmailTransporter(transporter as never);
  });
  afterAll(async () => {
    setEventEmailTransporter(undefined);
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all(
      [BookingModel, EventModel, EventGroupModel, OrganizationModel, VoucherModel, DataListModel, DataListRowModel, FieldClaimModel, BusRouteModel, BusBoardingModel, EventEmailModel, EmailDeliveryModel].map((m) =>
        (m as unknown as { deleteMany: (q: object) => Promise<unknown> }).deleteMany({}),
      ),
    );
    sent.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const entitled = { enabled: true };
    const org = await OrganizationModel.create({
      name: "Eventstructure",
      slug: "es",
      status: "active",
      modules: { "free-registration": entitled, "bus-transport": entitled, "event-emails": entitled },
    });
    orgId = String(org._id);
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: "h", apiKeyHint: "x", apiKeyCreatedAt: new Date() });
    groupId = String(group._id);

    const list = await createDataList(
      orgId,
      { name: "DSO", keyColumn: "dolgozo", keyNormalization: "digits_only", emailColumn: "email", nameColumn: "nev", columns: [{ key: "dolgozo", label: "Dolgozó" }, { key: "nev", label: "Név" }, { key: "email", label: "E-mail" }] },
      [
        { dolgozo: "60000001", nev: "Szőke Tibor", email: "szoke.tibor@mvm.hu" },
        { dolgozo: "60000003", nev: "Benkő László", email: "benko.laszlo@mvm.hu" },
        { dolgozo: "60000004", nev: "Bognár István", email: "bognar.istvan@mvm.hu" },
      ],
    );
    listId = String(list.list._id);

    const event = await EventModel.create({
      groupId: group._id,
      organizationId: org._id,
      name: "MVM Hálózatok Ünnepe 2026",
      status: "active",
      startDate: new Date(Date.now() + 20 * 86_400_000),
      endDate: new Date(Date.now() + 20 * 86_400_000),
      startTime: "18:00",
      endTime: "01:00",
      ticketFeeHuf: 0,
      capacity: 1300,
      vouchersEnabled: true,
      attendeeFieldSchemaMode: "replace",
      attendeeFieldSchema: [
        { key: "name", label: "Név", type: "text", required: true, sortOrder: 0 },
        { key: "employee_id", label: "Törzsszám", type: "text", required: true, unique: true, identifier: true, sortOrder: 1 },
        { key: "transfer", label: "Transzfer", type: "select", required: true, choices: [{ value: "igen", label: "Igen" }, { value: "nem", label: "Nem" }], sortOrder: 2 },
        { key: "bus", label: "Busz", type: "select", required: true, choicesSource: "bus-transport:routes", showWhen: { fieldKey: "transfer", values: ["igen"] }, sortOrder: 3 },
        { key: "consent", label: "Adatkezelés", type: "checkbox", required: true, sortOrder: 4 },
      ],
      eligibilityPreset: "form_rules",
      eligibilityFormRules: { logic: "and", rules: [{ id: "r1", fieldKey: "employee_id", op: "in_list", value: listId, message: "Ismeretlen törzsszám." }] },
      modules: { "free-registration": entitled, "bus-transport": entitled, "event-emails": entitled },
    });
    eventId = String(event._id);

    const route = await createRoute(orgId, eventId, { code: "B01", city: "Szeged", pickupPoint: "Mars tér", capacity: 1, captainName: "Kovács Péter", captainPhone: "+36 30 000 0000" });
    routeId = String(route._id);

    await createEventEmail(orgId, eventId, {
      name: "Visszaigazolás",
      subject: "Sikeres regisztráció – {{eventName}}",
      body: "<p>Szia {{firstName}}!</p><p>Azonosító: {{registrationNumber}}</p><p>Transzfer: {{bus.transfer}}</p>{{qrCode}}",
      trigger: "on_registration",
      audience: "registered",
      attachTicket: false,
    });
    await createEventEmail(orgId, eventId, {
      name: "Buszfoglalás",
      subject: "Buszfoglalás visszaigazolása",
      body: "<p>Szia {{firstName}}!</p><p>{{bus.city}} – {{bus.pickupPoint}} ({{bus.code}}), kapitány: {{bus.captainName}} {{bus.captainPhone}}</p>",
      trigger: "on_registration",
      audience: "registered",
      conditions: { logic: "and", rules: [{ id: "c1", fieldKey: "transfer", op: "equals", value: "igen", message: "" }] },
    });
  });

  const attendee = (fields: Record<string, string>) => ({ fields: { name: "Szőke Tibor", consent: "true", ...fields } });

  it("confirms a free registration at once: registration numbers, voucher, seat, and per-attendee emails", async () => {
    const result = await createBookingWithCheckout(
      { eventId, guests: 2, customer, attendees: [attendee({ employee_id: "60000001", transfer: "igen", bus: routeId }), { fields: { name: "Benkő László", employee_id: "60000003", transfer: "nem", consent: "true" } }] },
      { groupId },
    );

    expect(result.status).toBe("confirmed");
    expect(result.checkoutUrl).toContain("/foglalas/siker?bookingId=");
    const booking = await BookingModel.findById(result.bookingId);
    expect(booking?.status).toBe("confirmed");
    expect(booking?.paymentMethod).toBe("comp");
    expect(booking?.registrationNumber).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(booking?.attendees.every((a) => a.id && /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(a.registrationNumber ?? ""))).toBe(true);

    const vouchers = await VoucherModel.find({ bookingId: result.bookingId }).sort({ attendeeIndex: 1 });
    expect(vouchers).toHaveLength(2);
    expect(vouchers[0]?.registrationNumber).toBe(booking?.attendees[0]?.registrationNumber);

    expect((await BusRouteModel.findById(routeId))?.seatsTaken).toBe(1);

    // Two confirmations (one per attendee) + one bus email (only the passenger).
    expect(sent).toHaveLength(3);
    const confirmations = sent.filter((m) => m.subject.startsWith("Sikeres regisztráció"));
    expect(confirmations).toHaveLength(2);
    expect(confirmations[0]?.html).toContain("Szia Tibor!");
    expect(confirmations[0]?.html).toContain(booking?.attendees[0]?.registrationNumber);
    expect(confirmations[0]?.html).toContain("Transzfer: Igényelt");
    expect(confirmations[0]?.html).toContain('src="cid:registration-qr"');
    expect(confirmations[0]?.attachments?.some((a) => a.cid === "registration-qr")).toBe(true);
    expect(confirmations[1]?.html).toContain("Szia László!");
    expect(confirmations[1]?.html).toContain("Transzfer: Nem igényelt");
    const bus = sent.find((m) => m.subject === "Buszfoglalás visszaigazolása");
    expect(bus?.html).toContain("Szeged – Mars tér (B01), kapitány: Kovács Péter +36 30 000 0000");
    expect(await EmailDeliveryModel.countDocuments({ status: "sent", mode: "auto" })).toBe(3);
  });

  it("refuses an ID that isn't on the list, with the rule's own message", async () => {
    await expect(
      createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [attendee({ employee_id: "12345678", transfer: "nem" })] }, { groupId }),
    ).rejects.toThrow(/eligibility/);
    expect(await BookingModel.countDocuments({})).toBe(0);
  });

  it("refuses the same employee ID twice, and frees it again on cancellation", async () => {
    const first = await createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [attendee({ employee_id: "60000001", transfer: "nem" })] }, { groupId });
    await expect(
      createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [attendee({ employee_id: " 6000-0001 ", transfer: "nem" })] }, { groupId }),
    ).rejects.toThrow(/already registered/);

    await cancelBooking(first.bookingId);
    const again = await createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [attendee({ employee_id: "60000001", transfer: "nem" })] }, { groupId });
    expect(again.status).toBe("confirmed");
  });

  it("requires the consent checkbox and the bus only when a transfer is wanted", async () => {
    await expect(
      createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [{ fields: { name: "X", employee_id: "60000004", transfer: "nem" } }] }, { groupId }),
    ).rejects.toThrow(/attendee details/);
    await expect(
      createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [attendee({ employee_id: "60000004", transfer: "igen" })] }, { groupId }),
    ).rejects.toThrow(/attendee details/);
  });

  it("stops at the bus's seat limit and releases the seat (and the ID) when the registration fails or is cancelled", async () => {
    const first = await createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [attendee({ employee_id: "60000001", transfer: "igen", bus: routeId })] }, { groupId });
    await expect(
      createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [attendee({ employee_id: "60000003", transfer: "igen", bus: routeId })] }, { groupId }),
    ).rejects.toThrow(/attendee details|full/);
    // The refused registration must not keep 60000003 claimed.
    expect(await FieldClaimModel.countDocuments({ value: "60000003" })).toBe(0);

    await cancelBooking(first.bookingId);
    expect((await BusRouteModel.findById(routeId))?.seatsTaken).toBe(0);
  });

  it("gives the captain link access to its own bus only, with boarding per leg", async () => {
    await createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [attendee({ employee_id: "60000001", transfer: "igen", bus: routeId })] }, { groupId });
    const token = await rotateCaptainToken(orgId, routeId);
    const route = await findRouteByCaptainToken(token);
    expect(String(route?._id)).toBe(routeId);
    expect(await findRouteByCaptainToken("not-a-real-token-at-all-xxxxx")).toBeNull();

    const passengers = await listPassengers(route!);
    expect(passengers).toHaveLength(1);
    await setBoarding(route!, passengers[0]!.attendeeKey, "outbound", "boarded", "captain:B01");
    const after = await listPassengers(route!);
    expect(after[0]?.outbound).toBe("boarded");
    expect(after[0]?.return).toBeNull();
    expect(legCounts(after, "outbound")).toEqual({ booked: 1, boarded: 1, notBoarded: 0, missing: 0 });
    await expect(setBoarding(route!, "someone-else", "outbound", "boarded", "captain:B01")).rejects.toThrow(/isn't booked/);
  });

  it("sends a manual email to list rows that haven't registered yet, skipping those already sent", async () => {
    await createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [attendee({ employee_id: "60000001", transfer: "nem" })] }, { groupId });
    sent.length = 0;
    const email = await createEventEmail(orgId, eventId, {
      name: "Emlékeztető",
      subject: "Ne maradj le!",
      body: "<p>Szia {{firstName}}! {{siteUrl}}</p>",
      trigger: "manual",
      audience: "list_unregistered",
      listId,
      listMatchFieldKey: "employee_id",
    });
    await startEventEmailSend(orgId, String(email._id), null, { wait: true });
    expect(sent.map((m) => m.to).sort()).toEqual(["benko.laszlo@mvm.hu", "bognar.istvan@mvm.hu"]);
    expect(sent[0]?.html).toMatch(/Szia (László|István)!/);

    sent.length = 0;
    await startEventEmailSend(orgId, String(email._id), null, { wait: true });
    expect(sent).toHaveLength(0);
    const state = (await EventEmailModel.findById(email._id))?.sendState;
    expect(state).toMatchObject({ status: "done", total: 2, sent: 0, skipped: 2 });
  });

  it("does nothing module-specific when the organization isn't entitled", async () => {
    await OrganizationModel.updateOne({ _id: orgId }, { modules: {} });
    // Without free registration the booking needs Stripe, which isn't configured here.
    await expect(
      createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [attendee({ employee_id: "60000001", transfer: "nem" })] }, { groupId }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});
