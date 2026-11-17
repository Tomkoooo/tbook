import { MongoMemoryServer } from "mongodb-memory-server";
import { BookingModel, DataListModel, DataListRowModel, EventGroupModel, EventModel, FieldClaimModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { setModuleMailTransporter } from "@tbook/modules";
import { createDataList, generateApiKey, hashApiKey, vipRoster } from "@tbook/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getEvent } from "./events/[eventId]/route";
import { POST as postBooking } from "./bookings/route";
import { POST as vipLookup } from "./events/[eventId]/vip-lookup/route";
import { POST as guestCancel } from "./guest/cancel/route";

/**
 * VIP guests: a name list on the event, registration by name from a separate
 * seat pool (the general capacity is unaffected), exempt from the employee-list
 * rule, tagged "VIP" automatically.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const MODULES = { "free-registration": { enabled: true }, "guest-portal": { enabled: true } };
const FIELDS = [
  { key: "name", label: "Név", type: "text", required: true, sortOrder: 0 },
  { key: "employee_id", label: "Törzsszám", type: "text", required: true, unique: true, identifier: true, sortOrder: 1 },
  { key: "email", label: "E-mail", type: "email", required: true, sortOrder: 2 },
];
const customer = { name: "Teszt Elek", email: "leader@example.com", phone: "+36301112233", note: "" };

describe("v1: VIP guests", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let eventId: string;
  let apiKey: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.DATABASE_URL = mongod.getUri();
    await dbConnect(mongod.getUri());
    process.env.EMAIL_HOST = "smtp.test.invalid";
    process.env.EMAIL_USER = "noreply@test.invalid";
    process.env.EMAIL_PASS = "x";
    process.env.TBOOK_RATE_LIMIT_OVERRIDE = "100000";
    setModuleMailTransporter({ sendMail: async () => ({}) as never } as never);
  });

  afterAll(async () => {
    setModuleMailTransporter(undefined);
    delete process.env.TBOOK_RATE_LIMIT_OVERRIDE;
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([BookingModel, EventModel, EventGroupModel, OrganizationModel, VoucherModel, FieldClaimModel, DataListModel, DataListRowModel].map((m) => (m as unknown as { deleteMany: (q: object) => Promise<unknown> }).deleteMany({})));
    const org = await OrganizationModel.create({ name: "Eventstructure", slug: "es", status: "active", modules: MODULES });
    orgId = String(org._id);
    apiKey = generateApiKey();
    const group = await EventGroupModel.create({ name: "G", organizationId: org._id, status: "active", apiKeyHash: hashApiKey(apiKey), apiKeyHint: "tbk_x", apiKeyCreatedAt: new Date() });

    const dso = await createDataList(orgId, { name: "DSO", keyColumn: "id", keyNormalization: "digits_only", columns: [{ key: "id", label: "ID" }] }, [{ id: "60000001" }, { id: "60000002" }]);
    const vip = await createDataList(
      orgId,
      { name: "VIP", keyColumn: "nev", nameColumn: "nev", keyNormalization: "name", columns: [{ key: "nev", label: "Név" }] },
      [{ nev: "Dr. Németh András" }, { nev: "Gáborjáni-Szabó Szabolcs" }, { nev: "Kovács Gábor" }],
    );
    const event = await (EventModel as unknown as { create(doc: object): Promise<{ _id: unknown }> }).create({
      groupId: group._id,
      organizationId: orgId,
      name: "Ünnep",
      status: "active",
      startDate: new Date(Date.now() + 20 * 86_400_000),
      endDate: new Date(Date.now() + 20 * 86_400_000),
      ticketFeeHuf: 0,
      capacity: 1,
      vipListId: vip.list._id,
      vipCapacity: 2,
      vouchersEnabled: true,
      attendeeFieldSchemaMode: "replace",
      attendeeFieldSchema: FIELDS,
      eligibilityPreset: "form_rules",
      eligibilityFormRules: { logic: "and", rules: [{ id: "r1", fieldKey: "employee_id", op: "in_list", value: String(dso.list._id), message: "Nem jogosult" }] },
      modules: MODULES,
    });
    eventId = String(event._id);
  });

  const headers = () => ({ "X-TBook-Api-Key": apiKey, "Content-Type": "application/json" });
  const post = async (handler: unknown, path: string, body: unknown, params: Json = {}) => {
    const response = await (handler as (r: Request, c: unknown) => Promise<Response>)(
      new Request(`https://tbook.test/api/v1/${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) }),
      { params: Promise.resolve(params) },
    );
    return { status: response.status, body: (await response.json()) as Json };
  };
  const book = (id: string, name = `Vendég ${id}`) =>
    post(postBooking, "bookings", { eventId, guests: 1, customer, attendees: [{ fields: { name, employee_id: id, email: `${id.replace(/\W/g, "")}@example.com` } }] });
  const lookup = (name: string) => post(vipLookup, `events/${eventId}/vip-lookup`, { name }, { eventId });
  const event = async () => (await EventModel.findById(eventId).lean())!;

  it("finds a VIP by name ignoring accents, case, titles and spacing, and returns the list's spelling", async () => {
    const found = await lookup("nemeth  andras");
    expect(found.body).toMatchObject({ found: true, alreadyRegistered: false, name: "Dr. Németh András" });
    expect((await lookup("gaborjani szabo szabolcs")).body.name).toBe("Gáborjáni-Szabó Szabolcs");
    expect((await lookup("Nincs Ilyen")).body).toMatchObject({ found: false, name: null });
  });

  it("a VIP registers without an employee ID, from the VIP pool, and is tagged VIP", async () => {
    const res = await book("Dr. Németh András");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stored = (await BookingModel.findById(res.body.bookingId).lean())!;
    expect(stored.vipGuests).toBe(1);
    expect(stored.attendees[0]!.tags).toContain("VIP");
    expect(await VoucherModel.countDocuments({ bookingId: stored._id, tags: "VIP" })).toBeGreaterThan(0);
    const ev = await event();
    expect(ev).toMatchObject({ vipSoldCount: 1, soldGuestCount: 0 });
    expect((await lookup("Németh András")).body.alreadyRegistered).toBe(true);
    const again = await book("Dr. Németh András"); // one registration per VIP
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/már van regisztráció/);
  });

  it("someone who is neither an employee nor a VIP is still refused; VIPs don't use up the general seats", async () => {
    expect((await book("Valaki Más")).status).toBe(400);
    expect((await book("Gáborjáni-Szabó Szabolcs")).status).toBe(200);
    expect((await book("60000001")).status).toBe(200); // the one general seat is still free
    expect((await book("60000002")).status).toBe(400); // general pool full
    expect((await book("Kovács Gábor")).status).toBe(200); // ...but VIP seat 2 of 2
    expect(await event()).toMatchObject({ soldGuestCount: 1, vipSoldCount: 2 });
  });

  it("the VIP pool is capped on its own", async () => {
    await EventModel.updateOne({ _id: eventId }, { $set: { vipCapacity: 1 } });
    expect((await book("Kovács Gábor")).status).toBe(200);
    const second = await book("Dr. Németh András");
    expect(second.status).toBe(400);
    expect(second.body.code).toBe("capacity_full");
    expect(await event()).toMatchObject({ vipSoldCount: 1 });
  });

  it("cancelling a VIP gives the VIP seat back (not a general one) and the roster tracks who registered", async () => {
    await book("Kovács Gábor");
    await book("60000001");
    expect(await event()).toMatchObject({ vipSoldCount: 1, soldGuestCount: 1 });
    const roster = await vipRoster(eventId);
    expect(roster).toMatchObject({ registered: 1, total: 3 });
    expect(roster!.rows.find((r) => r.name === "Kovács Gábor")).toMatchObject({ registered: true });
    expect(roster!.rows.find((r) => r.name === "Dr. Németh András")).toMatchObject({ registered: false });

    const cancelled = await post(guestCancel, "guest/cancel", { eventId, code: "Kovács Gábor" });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await event()).toMatchObject({ vipSoldCount: 0, soldGuestCount: 1 });
  });

  it("the event detail tells the site whether VIP registration is on and how many VIP seats are left", async () => {
    await book("Kovács Gábor");
    const response = await getEvent(new Request(`https://tbook.test/api/v1/events/${eventId}`, { headers: headers() }), { params: Promise.resolve({ eventId }) });
    expect(((await response.json()) as Json).vip).toEqual({ enabled: true, remainingPlaces: 1 });
  });
});
