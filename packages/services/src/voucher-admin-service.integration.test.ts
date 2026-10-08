import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import { EventGroupModel, EventModel, OrganizationModel, VoucherModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertEventInOrg, listCheckInRosterForOrg, revertCheckInAsAdmin, scanVoucherAsAdmin } from "./voucher-admin-service";

describe("voucher-admin-service", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let otherOrgId: string;
  let eventId: string;
  let otherEventId: string;
  let legacyEventId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      EventModel.deleteMany({}),
      EventGroupModel.deleteMany({}),
      OrganizationModel.deleteMany({}),
      VoucherModel.deleteMany({}),
    ]);

    const apiKeyFields = { apiKeyHash: "hash", apiKeyHint: "tbk_xxxx", apiKeyCreatedAt: new Date() };
    const org = await OrganizationModel.create({ name: "Sörfeszt Kft", slug: "sorfeszt", status: "active" });
    const otherOrg = await OrganizationModel.create({ name: "Rival Kft", slug: "rival", status: "active" });
    orgId = String(org._id);
    otherOrgId = String(otherOrg._id);

    const group = await EventGroupModel.create({ name: "Sörfeszt 2026", organizationId: org._id, status: "active", ...apiKeyFields });
    const otherGroup = await EventGroupModel.create({ name: "Rival", organizationId: otherOrg._id, status: "active", ...apiKeyFields });

    const baseEvent = {
      status: "active" as const,
      startDate: new Date("2026-07-01"),
      endDate: new Date("2026-07-02"),
      ticketFeeHuf: 5000,
    };

    const event = await EventModel.create({ ...baseEvent, name: "Nyitónap", groupId: group._id, organizationId: org._id });
    const otherEvent = await EventModel.create({ ...baseEvent, name: "Rival Day", groupId: otherGroup._id, organizationId: otherOrg._id });
    // Production drift: an event with no organizationId, reachable only via its group.
    const legacyEvent = await EventModel.create({ ...baseEvent, name: "Régi nap", groupId: group._id });

    eventId = String(event._id);
    otherEventId = String(otherEvent._id);
    legacyEventId = String(legacyEvent._id);
  });

  async function seedVoucher(overrides: Record<string, unknown> = {}) {
    return VoucherModel.create({
      eventId: new Types.ObjectId(eventId),
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

  describe("event ownership", () => {
    it("accepts an event tagged with the org directly", async () => {
      await expect(assertEventInOrg(orgId, eventId)).resolves.toMatchObject({ name: "Nyitónap" });
    });

    it("accepts a legacy event with no organizationId via its group", async () => {
      // Without the group fallback, an org's oldest events would look like
      // another tenant's and the check-in screen would 404 on them.
      await expect(assertEventInOrg(orgId, legacyEventId)).resolves.toMatchObject({ name: "Régi nap" });
    });

    it("reports 404 (not 403) for another org's event", async () => {
      await expect(assertEventInOrg(orgId, otherEventId)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("roster", () => {
    it("reports check-in progress for the event", async () => {
      await seedVoucher({ displayName: "A", attendeeIndex: 0 });
      await seedVoucher({ displayName: "B", attendeeIndex: 1, status: "checked_in", checkedInAt: new Date() });
      await seedVoucher({ displayName: "C", attendeeIndex: 2, status: "void" });

      const roster = await listCheckInRosterForOrg(orgId, eventId);
      expect(roster.total).toBe(3);
      expect(roster.checkedIn).toBe(1);
      // A void entry is not admittable, so it must not count as outstanding.
      expect(roster.outstanding).toBe(1);
    });

    it("filters by status and searches by attendee name", async () => {
      await seedVoucher({ displayName: "Szabó Anna", attendeeIndex: 0 });
      await seedVoucher({ displayName: "Nagy Péter", attendeeIndex: 1, status: "checked_in" });

      expect((await listCheckInRosterForOrg(orgId, eventId, { status: ["checked_in"] })).total).toBe(1);
      expect((await listCheckInRosterForOrg(orgId, eventId, { search: "anna" })).total).toBe(1);
    });

    it("refuses another org's event", async () => {
      await expect(listCheckInRosterForOrg(orgId, otherEventId)).rejects.toMatchObject({ status: 404 });
    });

    it("pages the roster", async () => {
      for (let i = 0; i < 4; i += 1) await seedVoucher({ displayName: `Guest ${i}`, attendeeIndex: i });

      const page = await listCheckInRosterForOrg(orgId, eventId, {}, { pageSize: 2, page: 2 });
      expect(page.vouchers).toHaveLength(2);
      expect(page.pageCount).toBe(2);
    });
  });

  describe("scanning", () => {
    it("checks in a valid voucher", async () => {
      const voucher = await seedVoucher();
      const result = await scanVoucherAsAdmin(orgId, voucher.token, { eventId });
      expect(result.result).toBe("valid");

      const stored = await VoucherModel.findById(voucher._id);
      expect(stored?.status).toBe("checked_in");
    });

    it("reports a second scan as a duplicate rather than checking in again", async () => {
      const voucher = await seedVoucher();
      await scanVoucherAsAdmin(orgId, voucher.token, { eventId });
      const again = await scanVoucherAsAdmin(orgId, voucher.token, { eventId });
      expect(again.result).toBe("duplicate");
    });

    it("hides a voucher belonging to another org", async () => {
      const foreign = await seedVoucher({
        eventId: new Types.ObjectId(otherEventId),
        organizationId: new Types.ObjectId(otherOrgId),
      });

      const result = await scanVoucherAsAdmin(orgId, foreign.token);
      expect(result.result).toBe("invalid");
    });

    it("reports wrong_event when the code is for a different event in the same org", async () => {
      const voucher = await seedVoucher();
      const result = await scanVoucherAsAdmin(orgId, voucher.token, { eventId: legacyEventId });
      expect(result.result).toBe("wrong_event");
    });

    it("does not check in when mode is lookup", async () => {
      const voucher = await seedVoucher();
      const result = await scanVoucherAsAdmin(orgId, voucher.token, { eventId, mode: "lookup" });
      expect(result.result).toBe("valid");

      const stored = await VoucherModel.findById(voucher._id);
      expect(stored?.status).toBe("active");
    });

    it("rejects scanning against another org's event before touching the voucher", async () => {
      await expect(scanVoucherAsAdmin(orgId, "anything", { eventId: otherEventId })).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("reverting a check-in", () => {
    it("puts a checked-in entry back to active", async () => {
      const voucher = await seedVoucher({ status: "checked_in", checkedInAt: new Date(), checkedInByUserId: "u1" });

      const reverted = await revertCheckInAsAdmin(orgId, String(voucher._id));
      expect(reverted.status).toBe("active");
      expect(reverted.checkedInAt).toBeNull();
    });

    it("rejects reverting an entry that is not checked in", async () => {
      const voucher = await seedVoucher({ status: "active" });
      await expect(revertCheckInAsAdmin(orgId, String(voucher._id))).rejects.toMatchObject({ status: 400 });
    });

    it("refuses another org's voucher", async () => {
      const foreign = await seedVoucher({
        eventId: new Types.ObjectId(otherEventId),
        status: "checked_in",
        checkedInAt: new Date(),
      });
      await expect(revertCheckInAsAdmin(orgId, String(foreign._id))).rejects.toMatchObject({ status: 404 });
    });
  });
});
