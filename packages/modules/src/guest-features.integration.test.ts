import { MongoMemoryServer } from "mongodb-memory-server";
import {
  BookingModel,
  DataListModel,
  DataListRowModel,
  EventGroupModel,
  EventModel,
  FieldClaimModel,
  GuestTagRuleModel,
  OrganizationModel,
  VoucherModel,
  dbConnect,
  dbDisconnectAll,
} from "@tbook/db";
import {
  cancelBookingAttendee,
  createBookingWithCheckout,
  createDataList,
  createMultiBookingWithCheckout,
  eventReport,
  exportEventRegistrationsXlsx,
  listImportTargets,
  prefillRegistration,
  registrationPrefillSetup,
  updateBookingDetails,
} from "@tbook/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "./index";
import { BusRouteModel } from "./bus-transport/model";
import { createRoute } from "./bus-transport/service";
import { EmailDeliveryModel, EventEmailModel } from "./event-emails/model";
import { createEventEmail, setEventEmailTransporter } from "./event-emails/service";
import { SurveyModel, SurveyRespondentModel, SurveyResponseModel } from "./feedback/model";
import {
  createSurvey,
  getKiosk,
  getKioskForOrg,
  listOpenKiosks,
  personalFeedbackUrl,
  rotateKioskToken,
  submitKiosk,
  submitKioskForOrg,
  submitSurvey,
  surveyResults,
} from "./feedback/service";
import { cancelGuest, lookupGuest, updateGuest } from "./guest-portal/service";
import { WaitlistEntryModel } from "./waitlist/model";
import { acceptOffer, expireOffers, getOffer, joinWaitlist, listWaitlist, setWaitlistTransporter } from "./waitlist/service";

/**
 * The guest-facing features on top of a configured free registration:
 * edits that move bus seats and unique IDs, per-guest cancellation, guest
 * self-service by code, tags, waitlist (offer and auto), feedback, the
 * multi-event free path and the event report.
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
const ALL = { "free-registration": on, "bus-transport": on, "event-emails": on, "guest-portal": on, waitlist: on, feedback: on };

describe("guest features", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let groupId: string;
  let eventId: string;
  let busA: string;
  let busB: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
    process.env.EMAIL_HOST = "smtp.test.invalid";
    process.env.EMAIL_USER = "noreply@test.invalid";
    process.env.EMAIL_PASS = "x";
    setEventEmailTransporter(transporter as never);
    setWaitlistTransporter(transporter as never);
  });
  afterAll(async () => {
    setEventEmailTransporter(undefined);
    setWaitlistTransporter(undefined);
    await dbDisconnectAll();
    await mongod?.stop();
  });

  async function makeEvent(overrides: Record<string, unknown> = {}) {
    const event = await EventModel.create({
      groupId,
      organizationId: orgId,
      name: `Ünnep ${Math.random().toString(36).slice(2, 6)}`,
      status: "active",
      startDate: new Date(Date.now() + 20 * 86_400_000),
      endDate: new Date(Date.now() + 20 * 86_400_000),
      ticketFeeHuf: 0,
      capacity: 100,
      vouchersEnabled: true,
      attendeeFieldSchemaMode: "replace",
      attendeeFieldSchema: [
        { key: "name", label: "Név", type: "text", required: true, sortOrder: 0 },
        { key: "employee_id", label: "Törzsszám", type: "text", required: true, unique: true, identifier: true, sortOrder: 1 },
        { key: "email", label: "E-mail", type: "email", required: false, sortOrder: 2 },
        { key: "transfer", label: "Transzfer", type: "select", required: true, choices: [{ value: "igen", label: "Igen" }, { value: "nem", label: "Nem" }], sortOrder: 3 },
        { key: "bus", label: "Busz", type: "select", required: true, choicesSource: "bus-transport:routes", showWhen: { fieldKey: "transfer", values: ["igen"] }, sortOrder: 4 },
        { key: "diet", label: "Étkezés", type: "select", required: false, choices: [{ value: "normal", label: "Normál" }, { value: "veg", label: "Vegetáriánus" }], sortOrder: 5 },
      ],
      modules: ALL,
      ...overrides,
    });
    return String(event._id);
  }

  beforeEach(async () => {
    await Promise.all(
      [BookingModel, EventModel, EventGroupModel, OrganizationModel, VoucherModel, DataListModel, DataListRowModel, FieldClaimModel, BusRouteModel, EventEmailModel, EmailDeliveryModel, WaitlistEntryModel, SurveyModel, SurveyResponseModel, SurveyRespondentModel, GuestTagRuleModel].map((m) =>
        (m as unknown as { deleteMany: (q: object) => Promise<unknown> }).deleteMany({}),
      ),
    );
    sent.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const org = await OrganizationModel.create({ name: "ES", slug: "es", status: "active", modules: ALL });
    orgId = String(org._id);
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: "h", apiKeyHint: "x", apiKeyCreatedAt: new Date() });
    groupId = String(group._id);
    eventId = await makeEvent();
    busA = String((await createRoute(orgId, eventId, { code: "A", city: "Szeged", capacity: 1, captainName: "Kapitány Kázmér", captainPhone: "+36 30 000 0000" }))._id);
    busB = String((await createRoute(orgId, eventId, { code: "B", city: "Pécs", capacity: 1, captainName: "Nagy Anna", captainPhone: "+36 30 111 1111" }))._id);
  });

  const guest = (id: string, fields: Record<string, string> = {}) => ({ fields: { name: `Vendég ${id}`, employee_id: id, email: `${id}@example.com`, transfer: "nem", ...fields } });
  const register = (attendees: ReturnType<typeof guest>[], ev = eventId) =>
    createBookingWithCheckout({ eventId: ev, guests: attendees.length, customer, attendees }, { groupId });
  const seats = async (id: string) => (await BusRouteModel.findById(id))!.seatsTaken;

  it("an organizer edit keeps the registration number, moves the bus seat and the unique ID, and is logged", async () => {
    const { bookingId } = await register([guest("1001", { transfer: "igen", bus: busA })]);
    const before = (await BookingModel.findById(bookingId))!;
    const number = before.attendees[0]!.registrationNumber;
    expect(await seats(busA)).toBe(1);

    await updateBookingDetails(orgId, bookingId, { attendees: [guest("1002", { transfer: "igen", bus: busB })], editedBy: "u1" });
    const after = (await BookingModel.findById(bookingId))!;
    expect(after.attendees[0]!.registrationNumber).toBe(number);
    expect(await seats(busA)).toBe(0);
    expect(await seats(busB)).toBe(1);
    expect(await FieldClaimModel.exists({ value: "1001" })).toBeNull();
    expect(await FieldClaimModel.exists({ value: "1002" })).not.toBeNull();
    expect(after.changeLog.at(-1)?.by).toBe("admin:u1");
    expect(after.changeLog.at(-1)?.changes.map((c) => c.field)).toEqual(expect.arrayContaining(["Törzsszám", "Busz"]));

    // A full bus refuses the edit and leaves everything as it was.
    const { bookingId: other } = await register([guest("2001", { transfer: "igen", bus: busA })]);
    await expect(updateBookingDetails(orgId, other, { attendees: [guest("2001", { transfer: "igen", bus: busB })] })).rejects.toThrow();
    expect(await seats(busA)).toBe(1);
    expect(await seats(busB)).toBe(1);
    expect((await BookingModel.findById(other))!.attendees[0]!.fields.bus).toBe(busA);
  });

  it("cancelling one guest of a group keeps the record, frees the place, seat, ID and entry", async () => {
    const { bookingId } = await register([guest("1001"), guest("1002", { transfer: "igen", bus: busA }), guest("1003")]);
    const sold = (await EventModel.findById(eventId))!.soldGuestCount;
    await cancelBookingAttendee(bookingId, 1, { by: "admin:u1", reason: "beteg" });

    const booking = (await BookingModel.findById(bookingId))!;
    expect(booking.status).toBe("confirmed");
    expect(booking.guests).toBe(2);
    expect(booking.attendees.map((a) => a.fields.employee_id)).toEqual(["1001", "1003"]);
    expect(booking.cancelledAttendees[0]?.attendee.fields.employee_id).toBe("1002");
    expect(booking.cancelledAttendees[0]?.reason).toBe("beteg");
    expect((await EventModel.findById(eventId))!.soldGuestCount).toBe(sold - 1);
    expect(await seats(busA)).toBe(0);
    expect(await FieldClaimModel.exists({ value: "1002" })).toBeNull();
    const vouchers = await VoucherModel.find({ bookingId }).sort({ attendeeIndex: 1 });
    expect(vouchers.filter((v) => v.status === "active").map((v) => v.attendeeIndex)).toEqual([0, 1]);
    expect(vouchers.find((v) => v.attendeeIndex < 0)?.status).toBe("void");
    expect(vouchers.find((v) => v.attendeeIndex === 1)?.registrationNumber).toBe(booking.attendees[1]!.registrationNumber);

    // The last guest cancels the whole booking.
    await cancelBookingAttendee(bookingId, 0, { by: "guest" });
    await cancelBookingAttendee(bookingId, 0, { by: "guest" });
    expect((await BookingModel.findById(bookingId))!.status).toBe("cancelled");
    expect((await BookingModel.findById(bookingId))!.cancelledAttendees).toHaveLength(3);
  });

  it("a guest finds, edits and cancels their own registration by ID or registration number", async () => {
    await EventModel.updateOne({ _id: eventId }, { $set: { "modules.bus-transport.config": { transferRules: "A busz legfeljebb 15 percet vár." } } });
    const { bookingId } = await register([guest("1001", { transfer: "igen", bus: busA }), guest("1002")]);
    const number = (await BookingModel.findById(bookingId))!.attendees[1]!.registrationNumber!;

    const byId = await lookupGuest(eventId, "1001", groupId);
    expect(byId.bus).toMatchObject({ code: "A", captainName: "Kapitány Kázmér", captainPhone: "+36 30 000 0000" });
    expect(byId.transferRules).toBe("A busz legfeljebb 15 percet vár.");
    expect(byId.fields.email).toBe("1***@example.com");
    expect(byId.form.find((f) => f.key === "employee_id")?.editable).toBe(false);
    await expect(lookupGuest(eventId, "9999", groupId)).rejects.toThrow(/nem találtunk regisztrációt/);
    await expect(lookupGuest(eventId, "1001", "000000000000000000000000")).rejects.toThrow();

    sent.length = 0;
    await createEventEmail(orgId, eventId, { name: "Conf", subject: "Visszaigazolás", body: "<p>{{registrationNumber}}</p>", trigger: "on_registration", audience: "registered" });
    const changed = await updateGuest(eventId, number.toLowerCase(), { diet: "veg", employee_id: "7777", email: "1***@example.com" }, groupId);
    expect(changed.fields.diet).toBe("veg");
    const stored = (await BookingModel.findById(bookingId))!.attendees[1]!;
    expect(stored.fields.employee_id).toBe("1002");
    expect(stored.fields.email).toBe("1002@example.com");
    // An unconditional confirmation isn't sent again for a changed answer (only for a new address).
    expect(sent.map((m) => m.subject)).toEqual([]);

    // Dropping the transfer frees the bus seat.
    await updateGuest(eventId, "1001", { transfer: "nem" }, groupId);
    expect(await seats(busA)).toBe(0);

    await cancelGuest(eventId, "1002", "nem érek rá", groupId);
    const booking = (await BookingModel.findById(bookingId))!;
    expect(booking.guests).toBe(1);
    expect(booking.changeLog.some((c) => c.action === "attendee_cancelled" && c.by === "guest")).toBe(true);
    await expect(lookupGuest(eventId, "1002", groupId)).rejects.toThrow();
  });

  it("guest self-service is off unless the module is on", async () => {
    await EventModel.updateOne({ _id: eventId }, { $set: { "modules.guest-portal": { enabled: false } } });
    await register([guest("1001")]);
    await expect(lookupGuest(eventId, "1001")).rejects.toThrow(/önkiszolgálás/);
  });

  it("tags imported by ID reach registered guests now and later registrations on confirm", async () => {
    const { bookingId } = await register([guest("1001")]);
    const target = listImportTargets().find((t) => t.key === "core:guest-tags")!;
    expect(target).toBeDefined();
    const result = await target.apply(
      { organizationId: orgId, eventId, userId: "u1" },
      [
        { match: "1001", tags: "VIP" },
        { match: "1002", tags: "VIP, Sajtó" },
      ],
    );
    expect(result.updated).toBe(1);
    expect((await BookingModel.findById(bookingId))!.attendees[0]!.tags).toEqual(["VIP"]);
    expect((await VoucherModel.findOne({ bookingId }))!.tags).toEqual(["VIP"]);

    const later = await register([guest("1002")]);
    expect((await BookingModel.findById(later.bookingId))!.attendees[0]!.tags).toEqual(["VIP", "Sajtó"]);
    expect((await VoucherModel.findOne({ bookingId: later.bookingId }))!.tags).toEqual(["VIP", "Sajtó"]);
  });

  it("waitlist (offer): a freed place is held and offered, accepted once, and an expired offer moves on", async () => {
    const small = await makeEvent({ capacity: 1 });
    const first = await register([guest("1001")], small);
    await expect(joinWaitlist(small, { customer: { name: "A", email: "a@example.com", phone: "+36301" }, attendees: [guest("1001")] }, groupId)).rejects.toThrow(/már van regisztráció/);
    const a = await joinWaitlist(small, { customer: { name: "A", email: "a@example.com", phone: "+36301" }, attendees: [guest("2001")] }, groupId);
    const b = await joinWaitlist(small, { customer: { name: "B", email: "b@example.com", phone: "+36302" }, attendees: [guest("2002")] }, groupId);
    expect([a.position, b.position]).toEqual([1, 2]);
    await expect(joinWaitlist(small, { customer: { name: "A", email: "a@example.com", phone: "+36301" }, attendees: [guest("2003")] }, groupId)).rejects.toThrow(/már várólistán vagy/);

    sent.length = 0;
    await cancelBookingAttendee(first.bookingId, 0, { by: "guest" });
    const offered = (await WaitlistEntryModel.findById(a.entryId))!;
    expect(offered.status).toBe("offered");
    expect((await EventModel.findById(small))!.soldGuestCount).toBe(1); // held
    const link = sent.find((m) => m.to === "a@example.com")!.html.match(/\/waitlist\/([\w-]+)/)![1]!;
    expect((await getOffer(link))?.status).toBe("offered");

    // Nobody else can take the held place.
    await expect(register([guest("3001")], small)).rejects.toThrow(/elfogytak a szabad helyek/);

    const accepted = await acceptOffer(link);
    expect(accepted.status).toBe("confirmed");
    await expect(acceptOffer(link)).rejects.toThrow(/Már regisztráltál/);
    expect((await EventModel.findById(small))!.soldGuestCount).toBe(1);
    const entry = (await WaitlistEntryModel.findById(a.entryId))!;
    expect(entry.status).toBe("registered");

    // Free it again: B is offered; let the offer lapse.
    await cancelBookingAttendee(String(entry.bookingId), 0, { by: "guest" });
    expect((await WaitlistEntryModel.findById(b.entryId))!.status).toBe("offered");
    expect(await expireOffers(small, new Date(Date.now() + 49 * 3600_000))).toBe(1);
    expect((await WaitlistEntryModel.findById(b.entryId))!.status).toBe("expired");
    expect((await EventModel.findById(small))!.soldGuestCount).toBe(0);
    const listed = await listWaitlist(orgId, small);
    expect(listed.rows.map((r) => r.status)).toEqual(["registered", "expired"]);
  });

  it("waitlist (auto): the first in line is registered when a place frees up", async () => {
    const small = await makeEvent({ capacity: 1, modules: { ...ALL, waitlist: { enabled: true, config: { mode: "auto" } } } });
    const first = await register([guest("1001")], small);
    const a = await joinWaitlist(small, { customer: { name: "A", email: "a@example.com", phone: "+36301" }, attendees: [guest("2001")] }, groupId);
    sent.length = 0;
    await cancelBookingAttendee(first.bookingId, 0, { by: "guest" });
    const entry = (await WaitlistEntryModel.findById(a.entryId))!;
    expect(entry.status).toBe("registered");
    const booking = (await BookingModel.findById(entry.bookingId))!;
    expect(booking.status).toBe("confirmed");
    expect(booking.attendees[0]!.fields.employee_id).toBe("2001");
    expect(sent.some((m) => m.to === "a@example.com" && /Bekerültél/.test(m.subject))).toBe(true);
  });

  it("feedback: once per guest (by code or personal link), anonymous answers, kiosk taps, results", async () => {
    const { bookingId } = await register([guest("1001"), guest("1002")]);
    const survey = await createSurvey(orgId, eventId, {
      kind: "survey",
      title: "Hogy tetszett?",
      questions: [
        { type: "rating", label: "Összességében", required: true },
        { type: "choice", label: "Jönnél jövőre?", choices: ["Igen", "Nem"] },
        { type: "text", label: "Üzenet" },
      ],
    });
    const [q1, q2, q3] = survey.questions;
    await submitSurvey(String(survey._id), { code: "1001", answers: { [q1!.id]: 5, [q2!.id]: "Igen", [q3!.id]: "Szuper volt" } });
    await expect(submitSurvey(String(survey._id), { code: "1001", answers: { [q1!.id]: 1 } })).rejects.toThrow(/már kitöltötted/);
    await expect(submitSurvey(String(survey._id), { code: "nope", answers: { [q1!.id]: 1 } })).rejects.toThrow(/Nem találjuk/);
    await expect(submitSurvey(String(survey._id), { code: "1002", answers: { [q1!.id]: 9 } })).rejects.toThrow(/1–5/);

    const url = await personalFeedbackUrl((await BookingModel.findById(bookingId))!, 1);
    const token = new URL(url).searchParams.get("t")!;
    await submitSurvey(String(survey._id), { token, answers: { [q1!.id]: 3 } });
    await expect(submitSurvey(String(survey._id), { code: "1002", answers: { [q1!.id]: 3 } })).rejects.toThrow(/már kitöltötted/);
    await expect(submitSurvey(String(survey._id), { token: token.slice(0, -2) + "xx", answers: { [q1!.id]: 3 } })).rejects.toThrow(/Nem találjuk/);

    const response = await SurveyResponseModel.findOne({}).lean();
    expect(Object.keys(response!)).not.toContain("bookingId");

    const kiosk = await createSurvey(orgId, eventId, { kind: "kiosk", title: "Értékelj!", questions: [{ type: "rating", label: "Milyen a hangulat?", required: true }] });
    const kioskUrl = await rotateKioskToken(orgId, String(kiosk._id));
    const kioskToken = kioskUrl.split("/kiosk/")[1]!;
    expect((await getKiosk(kioskToken))?.title).toBe("Értékelj!");
    await submitKiosk(kioskToken, { [kiosk.questions[0]!.id]: 4 });
    await submitKiosk(kioskToken, { [kiosk.questions[0]!.id]: 5 });
    await expect(createSurvey(orgId, eventId, { kind: "kiosk", title: "x", questions: [{ type: "text", label: "Szöveg" }] })).rejects.toThrow(/kiosk/);

    const results = await surveyResults(orgId, String(survey._id));
    expect(results.total).toBe(2);
    expect(results.questions[0]!.average).toBe(4);
    expect(results.questions[1]!.counts).toEqual([{ label: "Igen", count: 1 }, { label: "Nem", count: 0 }]);
    expect(results.questions[2]!.texts).toEqual(["Szuper volt"]);
    expect((await surveyResults(orgId, String(kiosk._id))).questions[0]!.average).toBe(4.5);
  });

  it("the form starts with the ID: answers come from the data list, editable, and a registered ID returns no data", async () => {
    const { list } = await createDataList(
      orgId,
      { name: "Staff", keyColumn: "Dolgozó", keyNormalization: "digits_only", columns: ["Dolgozó", "Név", "E-mail", "Étrend"].map((key) => ({ key, label: key })) },
      [
        { Dolgozó: "2001", Név: "Minta Márta", "E-mail": "marta@example.com", Étrend: "Vegetáriánus" },
        { Dolgozó: "2002", Név: "Próba Pál", "E-mail": "pal@example.com", Étrend: "ismeretlen" },
      ],
    );
    const listId = String(list._id);
    const prefilled = await makeEvent({
      attendeeFieldSchema: [
        { key: "employee_id", label: "Törzsszám", type: "text", required: true, unique: true, identifier: true, sortOrder: 0 },
        { key: "name", label: "Név", type: "text", required: true, sortOrder: 1, prefillColumn: "Név" },
        { key: "email", label: "E-mail", type: "email", required: false, sortOrder: 2, prefillColumn: "E-mail" },
        { key: "diet", label: "Étkezés", type: "select", required: false, choices: [{ value: "normal", label: "Normál" }, { value: "veg", label: "Vegetáriánus" }], sortOrder: 3, prefillColumn: "Étrend" },
      ],
      eligibilityPreset: "form_rules",
      eligibilityFormRules: { logic: "and", rules: [{ id: "r1", fieldKey: "employee_id", op: "in_list", value: listId, message: "Nincs a listán." }] },
    });

    const event = await EventModel.findById(prefilled);
    expect(registrationPrefillSetup(event as never)).toMatchObject({ fieldKey: "employee_id", listId, columns: { name: "Név", email: "E-mail", diet: "Étrend" } });

    expect(await prefillRegistration(prefilled, " 2001 ")).toEqual({
      found: true,
      alreadyRegistered: false,
      fields: { employee_id: "2001", name: "Minta Márta", email: "marta@example.com", diet: "veg" },
    });
    // A cell that matches no dropdown option is left for the guest to answer.
    expect((await prefillRegistration(prefilled, "2002")).fields).toEqual({ employee_id: "2002", name: "Próba Pál", email: "pal@example.com" });
    expect(await prefillRegistration(prefilled, "9999")).toEqual({ found: false, alreadyRegistered: false, fields: {} });

    // The guest changes a prefilled answer; the normal checks still apply.
    await createBookingWithCheckout({ eventId: prefilled, guests: 1, customer, attendees: [{ fields: { employee_id: "2001", name: "Minta Márta Anna", email: "marta@example.com" } }] }, { groupId });
    expect(await prefillRegistration(prefilled, "2001")).toEqual({ found: true, alreadyRegistered: true, fields: { employee_id: "2001" } });

    // Without prefill columns the event has no ID-first step.
    expect(registrationPrefillSetup((await EventModel.findById(eventId)) as never)).toBeNull();
    await expect(prefillRegistration(eventId, "2001")).rejects.toThrow(/ID lookup/);
  });

  it("a signed-in kiosk member answers the org's open kiosks, stored like kiosk-link taps", async () => {
    const kiosk = await createSurvey(orgId, eventId, { kind: "kiosk", title: "Jósda", questions: [{ type: "rating", label: "Milyen volt?", required: true }] });
    await createSurvey(orgId, eventId, { kind: "survey", title: "Kérdőív", questions: [{ type: "rating", label: "Összességében", required: true }] });
    const id = String(kiosk._id);

    expect((await listOpenKiosks(orgId)).map((k) => k.title)).toEqual(["Jósda"]);
    expect((await getKioskForOrg(orgId, id))?.title).toBe("Jósda");
    expect(await getKioskForOrg("000000000000000000000000", id)).toBeNull();

    await submitKioskForOrg(orgId, id, { [kiosk.questions[0]!.id]: 5 });
    await expect(submitKioskForOrg("000000000000000000000000", id, { [kiosk.questions[0]!.id]: 5 })).rejects.toThrow(/isn't active/);
    expect(await SurveyResponseModel.countDocuments({ surveyId: kiosk._id, source: "kiosk" })).toBe(1);

    await SurveyModel.updateOne({ _id: kiosk._id }, { active: false });
    expect(await listOpenKiosks(orgId)).toEqual([]);
  });

  it("multi-event free registration confirms every booking without Stripe", async () => {
    const second = await makeEvent();
    const result = await createMultiBookingWithCheckout(
      { customer, entries: [{ eventId, guests: 1, attendees: [guest("1001")] }, { eventId: second, guests: 1, attendees: [guest("1001")] }] } as never,
      { groupId },
    );
    expect(result.status).toBe("confirmed");
    expect(result.stripeSessionId).toBe("");
    const bookings = await BookingModel.find({ _id: { $in: result.bookingIds } });
    expect(bookings.map((b) => b.status)).toEqual(["confirmed", "confirmed"]);
  });

  it("the event report counts guests, answers and cancellations, and exports them", async () => {
    const { bookingId } = await register([guest("1001", { diet: "veg" }), guest("1002", { diet: "normal" }), guest("1003", { transfer: "igen", bus: busA })]);
    await cancelBookingAttendee(bookingId, 1, { by: "guest" });
    const report = await eventReport(orgId, eventId);
    expect(report.guests).toBe(2);
    expect(report.registrations).toBe(1);
    expect(report.cancelledGuests).toBe(1);
    expect(report.breakdowns.find((b) => b.fieldKey === "bus")?.rows.find((r) => r.value === busA)).toMatchObject({ count: 1 });
    expect(report.breakdowns.find((b) => b.fieldKey === "diet")?.rows.find((r) => r.value === "veg")?.count).toBe(1);
    expect(report.perDay.at(-1)?.cumulative).toBe(2);
    const filtered = await eventReport(orgId, eventId, { fieldKey: "transfer", value: "igen" });
    expect(filtered.guests).toBe(1);
    const xlsx = await exportEventRegistrationsXlsx(orgId, eventId);
    expect(xlsx.buffer.length).toBeGreaterThan(1000);
    await expect(eventReport("000000000000000000000000", eventId)).rejects.toThrow();
  });
});
