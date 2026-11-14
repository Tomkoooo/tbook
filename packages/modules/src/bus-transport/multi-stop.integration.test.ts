import ExcelJS from "exceljs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, EventGroupModel, EventModel, FieldClaimModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { createBookingWithCheckout, createTestBookingWithCheckout, extensions, resolveModules } from "@tbook/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "../index";
import { EmailDeliveryModel, EventEmailModel } from "../event-emails/model";
import { createEventEmail, setEventEmailTransporter } from "../event-emails/service";
import { lookupGuest, updateGuest } from "../guest-portal/service";
import { setModuleMailTransporter } from "../shared/mail";
import { budapestToUtc } from "./index";
import { CAPTAIN_INFO_LATER, captainNoticeRecipients, sendCaptainNotice } from "./captain";
import { BusCaptainInformModel, BusRouteModel, BusWaitlistEntryModel } from "./model";
import { createRoute, exportPassengersXlsx, listPassengers, updateRoute, type BusRouteInput } from "./service";

/**
 * Multi-stop buses (one choice per stop, shared seats, the stop in emails,
 * lists and the guest API), {{bus.captainInfo}}, "captain informed"
 * tracking with the per-bus captain notice, and the portal's unmask option.
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
const ALL = { "free-registration": on, "bus-transport": on, "event-emails": on, "guest-portal": on };
const at = (hh: number, mm: number) => budapestToUtc(2026, 12, 4, hh, mm);

describe("multi-stop buses and the captain's details", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let groupId: string;
  let eventId: string;
  let multi: string;
  let single: string;
  const multiInput: BusRouteInput = {
    code: "B01",
    city: "Szombathely–Győr–Tatabánya",
    capacity: 2,
    returnInfo: "02:00-ig",
    sortOrder: 1,
    stops: [
      { city: "Szombathely", pickupPoint: "Rákóczi utca 23.", departureAt: at(13, 30) },
      { city: "Győr", pickupPoint: "Puskás Tivadar utca 37.", departureAt: at(15, 0) },
      { city: "Tatabánya", pickupPoint: "Eötvös utca 1.", departureAt: at(16, 0) },
    ],
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
    process.env.EMAIL_HOST = "smtp.test.invalid";
    process.env.EMAIL_USER = "noreply@test.invalid";
    process.env.EMAIL_PASS = "x";
    setEventEmailTransporter(transporter as never);
    setModuleMailTransporter(transporter as never);
  });
  afterAll(async () => {
    setEventEmailTransporter(undefined);
    setModuleMailTransporter(undefined);
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all(
      [BookingModel, EventModel, EventGroupModel, OrganizationModel, VoucherModel, FieldClaimModel, BusRouteModel, BusWaitlistEntryModel, BusCaptainInformModel, EventEmailModel, EmailDeliveryModel].map((m) =>
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
      capacity: 100,
      vouchersEnabled: true,
      attendeeFieldSchemaMode: "replace",
      attendeeFieldSchema: [
        { key: "name", label: "Név", type: "text", required: true, sortOrder: 0 },
        { key: "employee_id", label: "Törzsszám", type: "text", required: true, unique: true, identifier: true, sortOrder: 1 },
        { key: "email", label: "E-mail", type: "email", required: false, sortOrder: 2 },
        { key: "telefon", label: "Telefon", type: "phone", required: false, sortOrder: 3 },
        { key: "transfer", label: "Transzfer", type: "select", required: true, choices: [{ value: "igen", label: "Igen" }, { value: "nem", label: "Nem" }], sortOrder: 4 },
        { key: "bus", label: "Busz", type: "select", required: true, choicesSource: "bus-transport:routes", showWhen: { fieldKey: "transfer", values: ["igen"] }, sortOrder: 5 },
      ],
      modules: { ...ALL, "event-emails": { enabled: true, config: { siteUrl: "https://unnep.example.hu" } } },
    });
    eventId = String(event._id);
    multi = String((await createRoute(orgId, eventId, multiInput))._id);
    single = String((await createRoute(orgId, eventId, { code: "B02", city: "Baja", pickupPoint: "Bajcsy-Zsilinszky utca 6.", departureAt: at(15, 10), capacity: 5, sortOrder: 2, captainName: "Kapitány Kázmér", captainPhone: "+36 30 000 0000" }))._id);
  });

  const guest = (id: string, bus: string) => ({ fields: { name: `Vendég ${id}`, employee_id: id, email: `${id}@example.com`, telefon: "+36 30 123 4567", transfer: "igen", bus } });
  const register = (id: string, bus: string) => createBookingWithCheckout({ eventId, guests: 1, customer, attendees: [guest(id, bus)] }, { groupId });
  const choices = async () => {
    const event = (await EventModel.findById(eventId))!;
    const modules = await resolveModules({ organizationId: orgId, event });
    return extensions.choiceProvider("bus-transport:routes")!.list({ event, organizationId: orgId, groupId, modules });
  };

  it("offers one choice per stop; the stops share the bus's seats and fill up together", async () => {
    const before = await choices();
    expect(before.map((c) => c.value)).toEqual([`${multi}~0`, `${multi}~1`, `${multi}~2`, single, "waitlist"]);
    const gyor = before[1]!;
    expect(gyor.label).toBe("Győr – Puskás Tivadar utca 37., indulás 15:00 (Szombathely–Győr–Tatabánya, B01)");
    expect(gyor.meta).toMatchObject({
      code: "B01",
      routeName: "Szombathely–Győr–Tatabánya",
      city: "Győr",
      pickupPoint: "Puskás Tivadar utca 37.",
      departure: "2026. december 4. 15:00",
      departureAt: at(15, 0).toISOString(),
      returnInfo: "02:00-ig",
      stopIndex: 1,
    });
    expect(gyor.remaining).toBe(2);
    // A single-stop bus keeps today's value and label.
    expect(before[3]).toMatchObject({ value: single, label: "Baja – Bajcsy-Zsilinszky utca 6. (B02), 15:10" });

    await register("1001", `${multi}~0`);
    await register("1002", `${multi}~2`);
    expect((await BusRouteModel.findById(multi))!.seatsTaken).toBe(2);
    const full = await choices();
    expect(full.slice(0, 3).every((c) => c.disabled && c.remaining === 0)).toBe(true);
    // A full bus isn't selectable (any of its stops).
    await expect(register("1003", `${multi}~1`)).rejects.toThrow(/hibás érték|megtelt/);

    // Moving to another stop of the same (full) bus is fine: the seat stays theirs.
    await updateGuest(eventId, "1002", { bus: `${multi}~1` }, groupId);
    expect((await BusRouteModel.findById(multi))!.seatsTaken).toBe(2);

    // Removing a stop someone booked is refused.
    await expect(updateRoute(orgId, multi, { ...multiInput, stops: multiInput.stops!.slice(0, 1) })).rejects.toThrow(/removed/);
  });

  it("emails, the passenger list, the export and the guest API use the guest's stop", async () => {
    await createEventEmail(orgId, eventId, {
      name: "Busz",
      subject: "Busz",
      body: "<p>{{bus.city}}|{{bus.pickupPoint}}|{{bus.departure}}|{{bus.routeName}}|{{bus.code}}</p><p>{{bus.captainInfo}}</p>",
      trigger: "on_registration",
      audience: "registered",
    });
    await register("1002", `${multi}~2`);
    await register("1001", `${multi}~0`);
    const tata = sent.find((m) => m.to === "1002@example.com")!;
    expect(tata.html).toContain("Tatabánya|Eötvös utca 1.|2026. december 4. 16:00|Szombathely–Győr–Tatabánya|B01");
    expect(tata.html).toContain(CAPTAIN_INFO_LATER);
    // No captain yet: nobody is "informed".
    expect(await BusCaptainInformModel.countDocuments({})).toBe(0);

    const passengers = await listPassengers((await BusRouteModel.findById(multi))!);
    expect(passengers.map((p) => [p.name, p.stopIndex, p.stop])).toEqual([
      ["Vendég 1001", 0, "13:30 Szombathely – Rákóczi utca 23."],
      ["Vendég 1002", 2, "16:00 Tatabánya – Eötvös utca 1."],
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await exportPassengersXlsx([(await BusRouteModel.findById(multi))!])) as never);
    const sheet = workbook.getWorksheet("B01")!;
    expect(sheet.getRow(1).values).toEqual(expect.arrayContaining(["Felszállás", "Felszállási hely", "Név"]));
    expect([sheet.getRow(2).getCell(1).value, sheet.getRow(2).getCell(2).value, sheet.getRow(2).getCell(3).value]).toEqual(["13:30", "Szombathely – Rákóczi utca 23.", "Vendég 1001"]);
    expect(String(workbook.getWorksheet("Összesítő")!.getRow(2).getCell(3).value)).toContain("15:00 Győr");

    const view = await lookupGuest(eventId, "1002", groupId);
    expect(view.bus).toMatchObject({ code: "B01", city: "Tatabánya", pickupPoint: "Eötvös utca 1.", departure: "2026. december 4. 16:00", routeName: "Szombathely–Győr–Tatabánya", stopIndex: 2 });
  });

  it("portal: contact details are masked by default and unmasked with showContactUnmasked", async () => {
    await register("1001", single);
    const masked = await lookupGuest(eventId, "1001", groupId);
    expect(masked.fields).toMatchObject({ email: "1***@example.com", telefon: "***567" });
    expect(masked.form.find((f) => f.key === "email")?.masked).toBe(true);

    await EventModel.updateOne({ _id: eventId }, { $set: { "modules.guest-portal.config.showContactUnmasked": "yes" } });
    const open = await lookupGuest(eventId, "1001", groupId);
    expect(open.fields).toMatchObject({ email: "1001@example.com", telefon: "+36 30 123 4567" });
    expect(open.form.filter((f) => f.key === "email" || f.key === "telefon").map((f) => f.masked)).toEqual([false, false]);
    const updated = await updateGuest(eventId, "1001", { email: "uj@example.com", telefon: "+36 30 123 4567" }, groupId);
    expect(updated.fields).toMatchObject({ email: "uj@example.com", telefon: "+36 30 123 4567" });
  });

  it("captainInfo gives the captain's details when there is one; that confirmation marks the guest informed", async () => {
    await createEventEmail(orgId, eventId, { name: "Busz", subject: "Busz", body: "<p>{{bus.captainInfo}}</p>", trigger: "on_registration", audience: "registered" });
    await register("1001", single);
    expect(sent[0]!.html).toContain("Buszkapitány neve: Kapitány Kázmér<br>Buszkapitány telefonszáma: +36 30 000 0000");
    const route = (await BusRouteModel.findById(single))!;
    expect(await BusCaptainInformModel.countDocuments({ routeId: route._id })).toBe(1);
    expect(await captainNoticeRecipients(route)).toHaveLength(0);
  });

  it("captain notice: only this bus's not-yet-informed live passengers, marked after; a new captain re-opens it", async () => {
    // A test registration takes no seat.
    await createTestBookingWithCheckout({ eventId, guests: 1, customer, attendees: [guest("3001", `${multi}~1`)] }, { groupId });
    await register("1001", `${multi}~0`);
    await register("1002", `${multi}~2`);
    await register("2001", single);
    await expect(sendCaptainNotice(orgId, multi)).rejects.toThrow(/captain's name and phone/);

    await updateRoute(orgId, multi, { ...multiInput, captainName: "Busz Béla", captainPhone: "+36 20 111 2222" });
    let route = (await BusRouteModel.findById(multi))!;
    expect((await captainNoticeRecipients(route)).map((r) => r.displayName)).toEqual(["Vendég 1001", "Vendég 1002"]);
    expect((await captainNoticeRecipients(route, { test: true })).map((r) => r.displayName)).toEqual(["Vendég 3001"]);

    sent.length = 0;
    const result = await sendCaptainNotice(orgId, multi);
    expect(result).toMatchObject({ total: 2, sent: 2, failed: 0, createdTemplate: true });
    expect(sent.map((m) => m.to).sort()).toEqual(["1001@example.com", "1002@example.com"]);
    const tata = sent.find((m) => m.to === "1002@example.com")!;
    expect(tata.subject).toBe("Buszkapitányod elérhetősége – Ünnep");
    expect(tata.html).toContain("Buszkapitány neve: Busz Béla<br>Buszkapitány telefonszáma: +36 20 111 2222");
    expect(tata.html).toContain("Tatabánya, Eötvös utca 1. – indulás: 2026. december 4. 16:00");
    expect(await EventEmailModel.countDocuments({ eventId, trigger: "bus_captain_notice" })).toBe(1);
    expect(await captainNoticeRecipients(route)).toHaveLength(0);
    // The test guest is still waiting in the test line; the other bus's guest was never touched.
    expect(await captainNoticeRecipients(route, { test: true })).toHaveLength(1);
    expect(await BusCaptainInformModel.countDocuments({ routeId: single })).toBe(0);

    sent.length = 0;
    expect(await sendCaptainNotice(orgId, multi)).toMatchObject({ total: 0, sent: 0 });
    expect(sent).toHaveLength(0);

    // Test line: "[TESZT] " as always.
    expect(await sendCaptainNotice(orgId, multi, { test: true })).toMatchObject({ sent: 1 });
    expect(sent.map((m) => m.subject)).toEqual(["[TESZT] Buszkapitányod elérhetősége – Ünnep"]);

    // A new captain: everyone on the bus needs the new details.
    await updateRoute(orgId, multi, { ...multiInput, captainName: "Új Kapitány", captainPhone: "+36 20 333 4444" });
    route = (await BusRouteModel.findById(multi))!;
    expect(await captainNoticeRecipients(route)).toHaveLength(2);
    sent.length = 0;
    expect(await sendCaptainNotice(orgId, multi)).toMatchObject({ sent: 2, createdTemplate: false });
    expect(sent.every((m) => m.html.includes("Új Kapitány"))).toBe(true);
  });

  it("an answer given before the bus had stops keeps working", async () => {
    await register("1001", single);
    await updateRoute(orgId, single, {
      code: "B02",
      city: "Baja–Kalocsa",
      capacity: 5,
      captainName: "Kapitány Kázmér",
      captainPhone: "+36 30 000 0000",
      pickupPoint: "Bajcsy-Zsilinszky utca 6.",
      departureAt: at(15, 10),
      stops: [
        { city: "Baja", pickupPoint: "Bajcsy-Zsilinszky utca 6.", departureAt: at(15, 10) },
        { city: "Kalocsa", pickupPoint: "Fő tér", departureAt: at(15, 50) },
      ],
    });
    expect((await choices()).filter((c) => c.value.startsWith(single)).map((c) => c.value)).toEqual([`${single}~0`, `${single}~1`]);
    // Changing another answer while keeping the old bus answer is accepted.
    const view = await updateGuest(eventId, "1001", { telefon: "+36 30 999 8888" }, groupId);
    // Shown as the stop matching the bus's own pickup.
    expect(view.bus).toMatchObject({ code: "B02", city: "Baja", stopIndex: 0 });
    expect((await BusRouteModel.findById(single))!.seatsTaken).toBe(1);
    const passengers = await listPassengers((await BusRouteModel.findById(single))!);
    expect(passengers).toHaveLength(1);
  });
});
