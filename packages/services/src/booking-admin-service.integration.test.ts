import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import {
  BookingModel,
  EventGroupModel,
  EventModel,
  OrganizationModel,
  VoucherModel,
  dbConnect,
  dbDisconnectAll,
  eventRepository,
} from "@tbook/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cancelBookingAsAdmin,
  confirmBookingAsAdmin,
  getBookingDetailForOrg,
  listBookingFilterOptions,
  listBookingsForOrg,
  resolveBookingScope,
  streamBookingExportCsv,
} from "./booking-admin-service";

describe("booking-admin-service", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let otherOrgId: string;
  let groupId: string;
  let otherGroupId: string;
  let eventId: string;

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
      BookingModel.deleteMany({}),
      EventModel.deleteMany({}),
      EventGroupModel.deleteMany({}),
      OrganizationModel.deleteMany({}),
      VoucherModel.deleteMany({}),
    ]);

    const org = await OrganizationModel.create({ name: "Sörfeszt Kft", slug: "sorfeszt", status: "active" });
    const otherOrg = await OrganizationModel.create({ name: "Rival Kft", slug: "rival", status: "active" });
    orgId = String(org._id);
    otherOrgId = String(otherOrg._id);

    // The model requires the API-key triple on every group (legacy shape).
    const apiKeyFields = { apiKeyHash: "hash", apiKeyHint: "tbk_xxxx", apiKeyCreatedAt: new Date() };
    const group = await EventGroupModel.create({ name: "Sörfeszt 2026", organizationId: org._id, status: "active", ...apiKeyFields });
    const otherGroup = await EventGroupModel.create({ name: "Rival Fest", organizationId: otherOrg._id, status: "active", ...apiKeyFields });
    groupId = String(group._id);
    otherGroupId = String(otherGroup._id);

    const event = await EventModel.create({
      groupId: group._id,
      organizationId: org._id,
      name: "Nyitónap",
      status: "active",
      startDate: new Date("2026-07-01"),
      endDate: new Date("2026-07-02"),
      ticketFeeHuf: 5000,
      capacity: 100,
      soldGuestCount: 0,
    });
    eventId = String(event._id);
  });

  async function seedBooking(overrides: Record<string, unknown> = {}) {
    return BookingModel.create({
      organizationId: new Types.ObjectId(orgId),
      groupId: new Types.ObjectId(groupId),
      eventId: new Types.ObjectId(eventId),
      eventName: "Nyitónap",
      groupName: "Sörfeszt 2026",
      customer: { name: "Kovács Béla", email: "bela@example.com", phone: "+36301234567" },
      guests: 2,
      quote: { guests: 2, ticketSubtotalHuf: 10000, totalHuf: 10000 },
      totalHuf: 10000,
      status: "paid",
      ...overrides,
    });
  }

  describe("org scoping", () => {
    it("includes a legacy booking that has no organizationId but belongs to one of the org's groups", async () => {
      // Exactly the production drift in scripts/migration-fixtures: the
      // document predates the organizationId field entirely.
      await seedBooking({ organizationId: null, customer: { name: "Legacy Lajos", email: "lajos@example.com", phone: "+3611" } });

      const result = await listBookingsForOrg(orgId);
      expect(result.total).toBe(1);
      expect(result.bookings[0]?.customer.name).toBe("Legacy Lajos");
    });

    it("never leaks another org's bookings", async () => {
      await seedBooking();
      await seedBooking({
        organizationId: new Types.ObjectId(otherOrgId),
        groupId: new Types.ObjectId(otherGroupId),
        customer: { name: "Rival Rita", email: "rita@rival.example", phone: "+3622" },
      });

      const result = await listBookingsForOrg(orgId);
      expect(result.total).toBe(1);
      expect(result.bookings[0]?.customer.name).toBe("Kovács Béla");
    });

    it("resolves the scope's group ids from the org", async () => {
      const scope = await resolveBookingScope(orgId);
      expect(scope.groupIds).toEqual([groupId]);
    });

    it("returns nothing for an org with no groups and no directly-tagged bookings", async () => {
      const result = await listBookingsForOrg(otherOrgId);
      expect(result.total).toBe(0);
    });
  });

  describe("filtering", () => {
    it("filters by status", async () => {
      await seedBooking({ status: "paid" });
      await seedBooking({ status: "pending", customer: { name: "P", email: "p@example.com", phone: "+1" } });

      const result = await listBookingsForOrg(orgId, { status: ["pending"] });
      expect(result.total).toBe(1);
      expect(result.bookings[0]?.status).toBe("pending");
    });

    it("searches across customer name, email and phone", async () => {
      await seedBooking({ customer: { name: "Szabó Anna", email: "anna@example.com", phone: "+36301112222" } });
      await seedBooking({ customer: { name: "Nagy Péter", email: "peter@example.com", phone: "+36303334444" } });

      expect((await listBookingsForOrg(orgId, { search: "anna" })).total).toBe(1);
      expect((await listBookingsForOrg(orgId, { search: "PETER@EXAMPLE" })).total).toBe(1);
      expect((await listBookingsForOrg(orgId, { search: "3334444" })).total).toBe(1);
    });

    it("treats a regex metacharacter in the search term as a literal", async () => {
      await seedBooking({ customer: { name: "A.B", email: "ab@example.com", phone: "+1" } });
      await seedBooking({ customer: { name: "AXB", email: "axb@example.com", phone: "+2" } });

      // "." must not match any character here, or search silently over-matches.
      const result = await listBookingsForOrg(orgId, { search: "A.B" });
      expect(result.total).toBe(1);
      expect(result.bookings[0]?.customer.name).toBe("A.B");
    });

    it("a search term cannot widen the query past the org scope", async () => {
      await seedBooking({
        organizationId: new Types.ObjectId(otherOrgId),
        groupId: new Types.ObjectId(otherGroupId),
        customer: { name: "Rival Rita", email: "rita@rival.example", phone: "+3622" },
      });

      const result = await listBookingsForOrg(orgId, { search: "Rita" });
      expect(result.total).toBe(0);
    });

    it("filters by created-at range", async () => {
      await seedBooking({ createdAt: new Date("2026-01-10") });
      await seedBooking({ createdAt: new Date("2026-03-10"), customer: { name: "Later", email: "l@example.com", phone: "+3" } });

      const result = await listBookingsForOrg(orgId, { createdFrom: new Date("2026-02-01") });
      expect(result.total).toBe(1);
      expect(result.bookings[0]?.customer.name).toBe("Later");
    });
  });

  describe("totals", () => {
    it("counts revenue from paid and confirmed bookings only", async () => {
      await seedBooking({ status: "paid", totalHuf: 10000 });
      await seedBooking({ status: "confirmed", totalHuf: 5000, customer: { name: "C", email: "c@example.com", phone: "+4" } });
      // Neither of these is money collected — including them would overstate revenue.
      await seedBooking({ status: "pending", totalHuf: 999999, customer: { name: "D", email: "d@example.com", phone: "+5" } });
      await seedBooking({ status: "expired", totalHuf: 888888, customer: { name: "E", email: "e@example.com", phone: "+6" } });

      const result = await listBookingsForOrg(orgId);
      expect(result.grandTotalHuf).toBe(15000);
      expect(result.total).toBe(4);
    });

    it("reports totals for the filtered set, not the whole org", async () => {
      await seedBooking({ status: "paid", totalHuf: 10000 });
      await seedBooking({ status: "pending", totalHuf: 7000, customer: { name: "P", email: "p@example.com", phone: "+7" } });

      const result = await listBookingsForOrg(orgId, { status: ["pending"] });
      expect(result.statusTotals).toEqual([{ status: "pending", count: 1, totalHuf: 7000, guests: 2 }]);
    });
  });

  describe("paging", () => {
    it("pages and reports a page count", async () => {
      for (let i = 0; i < 5; i += 1) {
        await seedBooking({ customer: { name: `Guest ${i}`, email: `g${i}@example.com`, phone: `+${i}` } });
      }

      const first = await listBookingsForOrg(orgId, { pageSize: 2, page: 1 });
      expect(first.bookings).toHaveLength(2);
      expect(first.total).toBe(5);
      expect(first.pageCount).toBe(3);

      const last = await listBookingsForOrg(orgId, { pageSize: 2, page: 3 });
      expect(last.bookings).toHaveLength(1);
    });

    it("clamps an absurd page size instead of trusting it", async () => {
      await seedBooking();
      const result = await listBookingsForOrg(orgId, { pageSize: 100000 });
      expect(result.pageSize).toBe(200);
    });
  });

  describe("detail", () => {
    it("returns the booking with its vouchers", async () => {
      const booking = await seedBooking();
      await VoucherModel.create({
        eventId: new Types.ObjectId(eventId),
        bookingId: booking._id,
        attendeeIndex: 0,
        token: "tok-1",
        displayName: "Kovács Béla",
        eventSnapshot: { name: "Nyitónap", startDate: new Date("2026-07-01"), endDate: new Date("2026-07-02") },
      });

      const detail = await getBookingDetailForOrg(orgId, String(booking._id));
      expect(detail.vouchers).toHaveLength(1);
      expect(detail.vouchers[0]?.displayName).toBe("Kovács Béla");
    });

    it("reports 404 for another org's booking rather than 403", async () => {
      const booking = await seedBooking({
        organizationId: new Types.ObjectId(otherOrgId),
        groupId: new Types.ObjectId(otherGroupId),
      });

      await expect(getBookingDetailForOrg(orgId, String(booking._id))).rejects.toMatchObject({ status: 404 });
    });

    it("reports 404 for a malformed id instead of throwing a cast error", async () => {
      await expect(getBookingDetailForOrg(orgId, "not-an-object-id")).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("cancellation", () => {
    it("releases the event's capacity reservation", async () => {
      await eventRepository.reserveCapacity(eventId, 2);
      expect((await eventRepository.findById(eventId))?.soldGuestCount).toBe(2);

      const booking = await seedBooking({ status: "pending", guests: 2 });
      await cancelBookingAsAdmin(orgId, String(booking._id));

      // The gap this closes: before cancelBooking existed, only expiry
      // released capacity, so a cancelled booking held its seats forever.
      expect((await eventRepository.findById(eventId))?.soldGuestCount).toBe(0);
    });

    it("voids the booking's vouchers so an issued QR stops being admittable", async () => {
      const booking = await seedBooking();
      await VoucherModel.create({
        eventId: new Types.ObjectId(eventId),
        bookingId: booking._id,
        attendeeIndex: 0,
        token: "tok-void",
        status: "active",
        displayName: "Kovács Béla",
        eventSnapshot: { name: "Nyitónap", startDate: new Date("2026-07-01"), endDate: new Date("2026-07-02") },
      });

      await cancelBookingAsAdmin(orgId, String(booking._id));
      const voucher = await VoucherModel.findOne({ token: "tok-void" });
      expect(voucher?.status).toBe("void");
    });

    it("is idempotent and does not double-release capacity", async () => {
      await eventRepository.reserveCapacity(eventId, 2);
      const booking = await seedBooking({ status: "pending", guests: 2 });

      await cancelBookingAsAdmin(orgId, String(booking._id));
      await cancelBookingAsAdmin(orgId, String(booking._id));

      expect((await eventRepository.findById(eventId))?.soldGuestCount).toBe(0);
    });

    it("records the reason on the booking", async () => {
      const booking = await seedBooking();
      const updated = await cancelBookingAsAdmin(orgId, String(booking._id), { reason: "guest no-show" });
      expect(updated.customer.note).toContain("guest no-show");
    });

    it("refuses to cancel another org's booking", async () => {
      const booking = await seedBooking({
        organizationId: new Types.ObjectId(otherOrgId),
        groupId: new Types.ObjectId(otherGroupId),
      });
      await expect(cancelBookingAsAdmin(orgId, String(booking._id))).rejects.toMatchObject({ status: 404 });
    });

    it("rejects cancelling an already-expired booking", async () => {
      const booking = await seedBooking({ status: "expired" });
      await expect(cancelBookingAsAdmin(orgId, String(booking._id))).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("confirmation", () => {
    it("moves a paid booking to confirmed", async () => {
      const booking = await seedBooking({ status: "paid" });
      const updated = await confirmBookingAsAdmin(orgId, String(booking._id));
      expect(updated.status).toBe("confirmed");
    });

    it("refuses to confirm a pending booking", async () => {
      const booking = await seedBooking({ status: "pending" });
      await expect(confirmBookingAsAdmin(orgId, String(booking._id))).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("CSV export", () => {
    async function collect(generator: AsyncGenerator<string>): Promise<string> {
      let out = "";
      for await (const chunk of generator) out += chunk;
      return out;
    }

    it("streams a header plus one row per booking", async () => {
      await seedBooking({ customer: { name: "Kovács Béla", email: "bela@example.com", phone: "+36301234567" } });

      const csv = await collect(streamBookingExportCsv(orgId));
      const lines = csv.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("bookingId");
      expect(lines[1]).toContain("bela@example.com");
    });

    it("starts with a UTF-8 BOM so Excel reads accented names correctly", async () => {
      await seedBooking();
      const csv = await collect(streamBookingExportCsv(orgId));
      expect(csv.startsWith("\uFEFF")).toBe(true);
    });

    it("escapes a comma and a quote in a customer name", async () => {
      await seedBooking({ customer: { name: 'Nagy, Péter "Pete"', email: "p@example.com", phone: "+1" } });

      const csv = await collect(streamBookingExportCsv(orgId));
      expect(csv).toContain('"Nagy, Péter ""Pete"""');
    });

    it("honours the filter and the org scope", async () => {
      await seedBooking({ status: "paid" });
      await seedBooking({ status: "pending", customer: { name: "Pending Pal", email: "pal@example.com", phone: "+9" } });

      const csv = await collect(streamBookingExportCsv(orgId, { status: ["pending"] }));
      expect(csv).toContain("Pending Pal");
      expect(csv).not.toContain("bela@example.com");
    });
  });

  describe("filter options", () => {
    it("lists the org's groups and events for the dropdowns", async () => {
      const options = await listBookingFilterOptions(orgId);
      expect(options.groups).toEqual([{ id: groupId, name: "Sörfeszt 2026" }]);
      expect(options.events.map((e) => e.name)).toEqual(["Nyitónap"]);
    });

    it("includes archived events, which an admin still needs to look up", async () => {
      await EventModel.create({
        groupId: new Types.ObjectId(groupId),
        name: "Régi esemény",
        status: "archived",
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-01-02"),
        ticketFeeHuf: 1000,
      });

      const options = await listBookingFilterOptions(orgId);
      expect(options.events.map((e) => e.name).sort()).toEqual(["Nyitónap", "Régi esemény"]);
    });

    it("does not list another org's groups", async () => {
      const options = await listBookingFilterOptions(orgId);
      expect(options.groups.map((g) => g.name)).not.toContain("Rival Fest");
    });
  });
});
