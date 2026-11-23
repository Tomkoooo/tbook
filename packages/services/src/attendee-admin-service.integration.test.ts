import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import { EventGroupModel, EventModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listAttendeesForOrg } from "./attendee-admin-service";

describe("attendee-admin-service", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let eventId: string;
  let otherEventId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([EventModel.deleteMany({}), EventGroupModel.deleteMany({}), OrganizationModel.deleteMany({}), VoucherModel.deleteMany({})]);
    const apiKeyFields = { apiKeyHash: "hash", apiKeyHint: "tbk_xxxx", apiKeyCreatedAt: new Date() };
    const org = await OrganizationModel.create({ name: "Sörfeszt Kft", slug: "sorfeszt", status: "active" });
    const other = await OrganizationModel.create({ name: "Rival Kft", slug: "rival", status: "active" });
    orgId = String(org._id);
    const group = await EventGroupModel.create({ name: "Sörfeszt 2026", organizationId: org._id, status: "active", ...apiKeyFields });
    const otherGroup = await EventGroupModel.create({ name: "Rival", organizationId: other._id, status: "active", ...apiKeyFields });
    const base = { status: "active" as const, startDate: new Date("2026-07-01"), endDate: new Date("2026-07-02"), ticketFeeHuf: 5000 };
    const event = await EventModel.create({
      ...base,
      name: "Nyitónap",
      groupId: group._id,
      organizationId: org._id,
      attendeeFieldSchema: [
        { key: "munkaltato", label: "Munkáltató", type: "select", choices: [{ value: "dhel", label: "DHEL" }, { value: "mav", label: "MÁV" }] },
        { key: "vega", label: "Vegetáriánus", type: "checkbox" },
        { key: "torzsszam", label: "Törzsszám", type: "text", identifier: true },
      ],
    });
    const otherEvent = await EventModel.create({ ...base, name: "Rival Day", groupId: otherGroup._id, organizationId: other._id });
    eventId = String(event._id);
    otherEventId = String(otherEvent._id);
  });

  async function seed(overrides: Record<string, unknown> = {}, forEvent = eventId) {
    return VoucherModel.create({
      eventId: new Types.ObjectId(forEvent),
      bookingId: new Types.ObjectId(),
      organizationId: new Types.ObjectId(orgId),
      attendeeIndex: 0,
      token: `tok-${Math.random().toString(36).slice(2)}`,
      status: "active",
      displayName: "Kovács Béla",
      eventSnapshot: { name: "Nyitónap", startDate: new Date("2026-07-01"), endDate: new Date("2026-07-02") },
      ...overrides,
    });
  }

  it("lists one row per guest with the answers as readable labels, and splits the choice questions", async () => {
    await seed({ displayName: "Kovács Béla", attendeeFields: { munkaltato: "dhel", vega: true, torzsszam: "1001" } });
    await seed({ displayName: "Nagy Anna", attendeeFields: { munkaltato: "dhel", vega: false, torzsszam: "1002" }, status: "checked_in", checkedInAt: new Date() });
    await seed({ displayName: "Szabó Gergő", attendeeFields: { munkaltato: "mav", vega: "on", torzsszam: "1003" } });

    const result = await listAttendeesForOrg(orgId, { sortBy: "name", sortDir: "asc" });
    expect(result.total).toBe(3);
    expect(result.checkedIn).toBe(1);
    expect(result.rows.map((row) => row.name)).toEqual(["Kovács Béla", "Nagy Anna", "Szabó Gergő"]);
    expect(result.rows[0]!.answers).toMatchObject({ munkaltato: "DHEL", vega: "Igen", torzsszam: "1001" });
    expect(result.fields.find((field) => field.key === "torzsszam")?.identifier).toBe(true);

    const employer = result.breakdowns.find((breakdown) => breakdown.fieldKey === "munkaltato")!;
    expect(employer.rows).toEqual([
      { value: "dhel", label: "DHEL", count: 2 },
      { value: "mav", label: "MÁV", count: 1 },
    ]);
    // "on" and true both count as ticked.
    expect(result.breakdowns.find((breakdown) => breakdown.fieldKey === "vega")!.rows.find((row) => row.value === "yes")?.count).toBe(2);
  });

  it("filters by answer, door state and search, and the split follows the filter", async () => {
    await seed({ displayName: "Kovács Béla", attendeeFields: { munkaltato: "dhel", vega: true, torzsszam: "1001" } });
    await seed({ displayName: "Nagy Anna", attendeeFields: { munkaltato: "dhel", vega: false, torzsszam: "1002" }, status: "checked_in" });
    await seed({ displayName: "Szabó Gergő", attendeeFields: { munkaltato: "mav", vega: true, torzsszam: "1003" } });

    expect((await listAttendeesForOrg(orgId, { answers: { munkaltato: ["dhel"] } })).total).toBe(2);
    expect((await listAttendeesForOrg(orgId, { answers: { vega: ["yes"] } })).total).toBe(2);
    expect((await listAttendeesForOrg(orgId, { answers: { vega: ["no"] } })).total).toBe(1);
    expect((await listAttendeesForOrg(orgId, { status: ["checked_in"] })).rows.map((row) => row.name)).toEqual(["Nagy Anna"]);
    expect((await listAttendeesForOrg(orgId, { search: "1003" })).rows.map((row) => row.name)).toEqual(["Szabó Gergő"]);

    const dhel = await listAttendeesForOrg(orgId, { answers: { munkaltato: ["dhel"] } });
    expect(dhel.breakdowns.find((breakdown) => breakdown.fieldKey === "munkaltato")!.rows).toEqual([{ value: "dhel", label: "DHEL", count: 2 }]);
  });

  it("leaves out void tickets, pages the rest, and never shows another organization's guests", async () => {
    for (let index = 0; index < 5; index += 1) await seed({ displayName: `Guest ${index}`, attendeeIndex: index });
    await seed({ displayName: "Void", attendeeIndex: 9, status: "void" });
    await seed({ displayName: "Rival guest" }, otherEventId);

    const page = await listAttendeesForOrg(orgId, { pageSize: 2, page: 2, sortBy: "name", sortDir: "asc" });
    expect(page.total).toBe(5);
    expect(page.rows.map((row) => row.name)).toEqual(["Guest 2", "Guest 3"]);
    await expect(listAttendeesForOrg(orgId, { eventId: otherEventId })).rejects.toThrow(/not found/i);
  });
});
