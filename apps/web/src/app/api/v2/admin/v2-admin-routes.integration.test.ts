import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import {
  BookingModel,
  EventGroupModel,
  EventModel,
  OrgMembershipModel,
  OrgRoleModel,
  OrganizationModel,
  VoucherModel,
  dbConnect,
  dbDisconnectAll,
} from "@tbook/db";
import { addMember, createOrganization, listRoles } from "@tbook/services";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level tests for the v2 admin surface. Same approach as the v1
 * suite: import the real route handlers and invoke them with constructed
 * Requests. The point here is the *auth wiring* — that each endpoint reads
 * its org from the session rather than the request, and enforces the right
 * permission from the catalog — since the underlying services have their
 * own suites.
 *
 * `@/auth`'s `auth()` is the mocked seam rather than `@/lib/admin-auth`, so
 * the real session → org-context → requireOrgPermission chain runs against
 * a real database. Mocking one layer higher would skip exactly what these
 * tests exist to check.
 */

interface FakeSession {
  user: { id: string; email: string; isSystemAdmin: boolean; organizationIds: string[]; activeOrganizationId?: string };
}

let currentSession: FakeSession | null = null;
const cookieJar = new Map<string, string>();

vi.mock("@/auth", () => ({
  auth: async () => currentSession,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (options: { name: string; value: string }) => cookieJar.set(options.name, options.value),
  }),
}));

const { GET: listBookings } = await import("./bookings/route");
const { GET: getBooking, PATCH: patchBooking } = await import("./bookings/[bookingId]/route");
const { GET: exportBookings } = await import("./bookings/export/route");
const { POST: resendEntries } = await import("./bookings/[bookingId]/resend-entries/route");
const { GET: getRoster } = await import("./events/[eventId]/check-ins/route");
const { POST: scan } = await import("./vouchers/scan/route");
const { POST: revertCheckIn } = await import("./vouchers/[voucherId]/revert-check-in/route");
const { GET: listOrgs } = await import("./orgs/route");
const { POST: setActiveOrg, DELETE: clearActiveOrg } = await import("./orgs/active/route");
const { GET: getFilterOptions } = await import("./filter-options/route");

const OWNER_USER_ID = new Types.ObjectId().toHexString();
const VIEWER_USER_ID = new Types.ObjectId().toHexString();
const OUTSIDER_USER_ID = new Types.ObjectId().toHexString();

describe("v2 admin API routes", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let otherOrgId: string;
  let groupId: string;
  let eventId: string;
  let bookingId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  afterEach(() => {
    currentSession = null;
    cookieJar.clear();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await Promise.all([
      BookingModel.deleteMany({}),
      EventModel.deleteMany({}),
      EventGroupModel.deleteMany({}),
      OrganizationModel.deleteMany({}),
      OrgMembershipModel.deleteMany({}),
      OrgRoleModel.deleteMany({}),
      VoucherModel.deleteMany({}),
    ]);

    const { organization } = await createOrganization({ name: "Sörfeszt Kft", ownerUserId: OWNER_USER_ID });
    orgId = organization.id;

    // A Viewer has booking:read but neither booking:manage nor
    // booking:export — the split this suite checks is enforced.
    const roles = await listRoles(orgId);
    const viewerRoleId = roles.find((role) => role.name === "Viewer")!.id;
    await addMember({ organizationId: orgId, userId: VIEWER_USER_ID, roleIds: [viewerRoleId] });

    const { organization: otherOrg } = await createOrganization({ name: "Rival Kft", ownerUserId: OUTSIDER_USER_ID });
    otherOrgId = otherOrg.id;

    const group = await EventGroupModel.create({
      name: "Sörfeszt 2026",
      organizationId: new Types.ObjectId(orgId),
      status: "active",
      apiKeyHash: "hash",
      apiKeyHint: "tbk_xxxx",
      apiKeyCreatedAt: new Date(),
    });
    groupId = String(group._id);

    const event = await EventModel.create({
      groupId: group._id,
      organizationId: new Types.ObjectId(orgId),
      name: "Nyitónap",
      status: "active",
      startDate: new Date("2026-07-01"),
      endDate: new Date("2026-07-02"),
      ticketFeeHuf: 5000,
      capacity: 100,
    });
    eventId = String(event._id);

    const booking = await BookingModel.create({
      organizationId: new Types.ObjectId(orgId),
      groupId: group._id,
      eventId: event._id,
      eventName: "Nyitónap",
      groupName: "Sörfeszt 2026",
      customer: { name: "Kovács Béla", email: "bela@example.com", phone: "+36301234567" },
      guests: 2,
      quote: { guests: 2, ticketSubtotalHuf: 10000, totalHuf: 10000 },
      totalHuf: 10000,
      status: "paid",
    });
    bookingId = String(booking._id);
  });

  function signIn(userId: string, opts: { isSystemAdmin?: boolean; activeOrganizationId?: string | null } = {}) {
    const activeOrganizationId = opts.activeOrganizationId === undefined ? orgId : opts.activeOrganizationId;
    currentSession = {
      user: {
        id: userId,
        email: `${userId}@example.com`,
        isSystemAdmin: opts.isSystemAdmin ?? false,
        organizationIds: activeOrganizationId ? [activeOrganizationId] : [],
        ...(activeOrganizationId ? { activeOrganizationId } : {}),
      },
    };
  }

  async function body(response: Response) {
    return (await response.json()) as { data?: unknown; meta?: Record<string, unknown>; error?: { code: string; message: string } };
  }

  describe("authentication and org scoping", () => {
    it("401s an unauthenticated booking list", async () => {
      const response = await listBookings(new Request("http://localhost/api/v2/admin/bookings"));
      expect(response.status).toBe(401);
      expect((await body(response)).error?.code).toBe("unauthorized");
    });

    it("403s a signed-in user with no active organization", async () => {
      signIn(OWNER_USER_ID, { activeOrganizationId: null });
      const response = await listBookings(new Request("http://localhost/api/v2/admin/bookings"));
      expect(response.status).toBe(403);
    });

    it("403s a user who is not a member of the active organization", async () => {
      signIn(OUTSIDER_USER_ID, { activeOrganizationId: orgId });
      const response = await listBookings(new Request("http://localhost/api/v2/admin/bookings"));
      expect(response.status).toBe(403);
    });

    it("takes the org from the session, so a query param cannot cross tenants", async () => {
      signIn(OWNER_USER_ID);
      // organizationId is deliberately not an accepted filter — passing one
      // must be ignored, not honoured.
      const response = await listBookings(
        new Request(`http://localhost/api/v2/admin/bookings?organizationId=${otherOrgId}`),
      );
      expect(response.status).toBe(200);
      const payload = await body(response);
      expect(payload.meta?.total).toBe(1);
      expect((payload.data as Array<{ customer: { name: string } }>)[0]?.customer.name).toBe("Kovács Béla");
    });

    it("falls back to the active-org cookie when the session has no active org", async () => {
      cookieJar.set("tbook_active_org", orgId);
      currentSession = {
        user: { id: OWNER_USER_ID, email: "o@example.com", isSystemAdmin: false, organizationIds: [orgId] },
      };

      const response = await listBookings(new Request("http://localhost/api/v2/admin/bookings"));
      expect(response.status).toBe(200);
    });
  });

  describe("permissions", () => {
    it("lets a Viewer read the booking table", async () => {
      signIn(VIEWER_USER_ID);
      const response = await listBookings(new Request("http://localhost/api/v2/admin/bookings"));
      expect(response.status).toBe(200);
    });

    it("denies a Viewer the CSV export (booking:export is a separate permission)", async () => {
      signIn(VIEWER_USER_ID);
      const response = await exportBookings(new Request("http://localhost/api/v2/admin/bookings/export"));
      expect(response.status).toBe(403);
      // Must be the JSON error envelope, not a half-written CSV.
      expect(response.headers.get("Content-Type")).toContain("application/json");
    });

    it("denies a Viewer a cancellation (booking:manage)", async () => {
      signIn(VIEWER_USER_ID);
      const response = await patchBooking(
        new Request(`http://localhost/api/v2/admin/bookings/${bookingId}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "cancel" }),
        }),
        { params: Promise.resolve({ bookingId }) },
      );
      expect(response.status).toBe(403);
    });

    it("lets an Owner export", async () => {
      signIn(OWNER_USER_ID);
      const response = await exportBookings(new Request("http://localhost/api/v2/admin/bookings/export"));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/csv");
      expect(await response.text()).toContain("bela@example.com");
    });
  });

  describe("booking list", () => {
    it("returns the { data, meta } envelope with pagination", async () => {
      signIn(OWNER_USER_ID);
      const response = await listBookings(new Request("http://localhost/api/v2/admin/bookings?pageSize=10"));
      const payload = await body(response);

      expect(payload.meta).toMatchObject({ page: 1, pageSize: 10, total: 1, pageCount: 1 });
      expect(payload.meta?.grandTotalHuf).toBe(10000);
    });

    it("rejects a malformed filter instead of silently ignoring it", async () => {
      signIn(OWNER_USER_ID);
      const response = await listBookings(new Request("http://localhost/api/v2/admin/bookings?eventId=nope"));
      expect(response.status).toBe(400);
      expect((await body(response)).error?.code).toBe("validation_error");
    });

    it("ignores an unknown status value rather than matching nothing", async () => {
      signIn(OWNER_USER_ID);
      // `{ $in: [] }` would match no rows at all; the filter should be dropped.
      const response = await listBookings(new Request("http://localhost/api/v2/admin/bookings?status=bogus"));
      expect(response.status).toBe(200);
      expect((await body(response)).meta?.total).toBe(1);
    });

    it("never exposes a voucher token in the list or detail payload", async () => {
      await VoucherModel.create({
        eventId: new Types.ObjectId(eventId),
        bookingId: new Types.ObjectId(bookingId),
        attendeeIndex: 0,
        token: "super-secret-token",
        displayName: "Kovács Béla",
        eventSnapshot: { name: "Nyitónap", startDate: new Date("2026-07-01"), endDate: new Date("2026-07-02") },
      });

      signIn(OWNER_USER_ID);
      const response = await getBooking(new Request(`http://localhost/api/v2/admin/bookings/${bookingId}`), {
        params: Promise.resolve({ bookingId }),
      });
      const text = JSON.stringify(await body(response));
      expect(text).not.toContain("super-secret-token");
    });
  });

  describe("booking detail and actions", () => {
    it("404s another org's booking", async () => {
      const foreign = await BookingModel.create({
        organizationId: new Types.ObjectId(otherOrgId),
        eventId: new Types.ObjectId(eventId),
        eventName: "Other",
        customer: { name: "X", email: "x@example.com", phone: "+1" },
        guests: 1,
        quote: { guests: 1, ticketSubtotalHuf: 1, totalHuf: 1 },
        totalHuf: 1,
      });

      signIn(OWNER_USER_ID);
      const response = await getBooking(new Request("http://localhost/x"), {
        params: Promise.resolve({ bookingId: String(foreign._id) }),
      });
      expect(response.status).toBe(404);
    });

    it("cancels a booking", async () => {
      signIn(OWNER_USER_ID);
      const response = await patchBooking(
        new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ action: "cancel", reason: "no-show" }) }),
        { params: Promise.resolve({ bookingId }) },
      );
      expect(response.status).toBe(200);
      expect((await body(response)).data).toMatchObject({ status: "cancelled" });
    });

    it("confirms a paid booking", async () => {
      signIn(OWNER_USER_ID);
      const response = await patchBooking(
        new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ action: "confirm" }) }),
        { params: Promise.resolve({ bookingId }) },
      );
      expect((await body(response)).data).toMatchObject({ status: "confirmed" });
    });

    it("rejects an unsupported action", async () => {
      signIn(OWNER_USER_ID);
      const response = await patchBooking(
        new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ action: "delete" }) }),
        { params: Promise.resolve({ bookingId }) },
      );
      expect(response.status).toBe(400);
    });

    it("reports a malformed JSON body as a 400, not a 500", async () => {
      signIn(OWNER_USER_ID);
      const response = await patchBooking(new Request("http://localhost/x", { method: "PATCH", body: "{not json" }), {
        params: Promise.resolve({ bookingId }),
      });
      expect(response.status).toBe(400);
    });

    it("refuses to re-send entries for a booking that has none", async () => {
      signIn(OWNER_USER_ID);
      const response = await resendEntries(
        new Request("http://localhost/x", { method: "POST", body: JSON.stringify({}) }),
        { params: Promise.resolve({ bookingId }) },
      );
      expect(response.status).toBe(400);
      expect((await body(response)).error?.message).toContain("no entries");
    });
  });

  describe("check-in", () => {
    async function seedVoucher(overrides: Record<string, unknown> = {}) {
      return VoucherModel.create({
        eventId: new Types.ObjectId(eventId),
        bookingId: new Types.ObjectId(bookingId),
        organizationId: new Types.ObjectId(orgId),
        attendeeIndex: 0,
        token: `tok-${Math.random().toString(36).slice(2)}`,
        status: "active",
        displayName: "Kovács Béla",
        eventSnapshot: { name: "Nyitónap", startDate: new Date("2026-07-01"), endDate: new Date("2026-07-02") },
        ...overrides,
      });
    }

    it("returns the roster with check-in progress", async () => {
      await seedVoucher();
      await seedVoucher({ attendeeIndex: 1, status: "checked_in", checkedInAt: new Date() });

      signIn(OWNER_USER_ID);
      const response = await getRoster(new Request("http://localhost/x"), { params: Promise.resolve({ eventId }) });
      const payload = await body(response);

      expect(payload.meta).toMatchObject({ total: 2, checkedIn: 1, outstanding: 1 });
    });

    it("checks a voucher in and reports a duplicate on re-scan", async () => {
      const voucher = await seedVoucher();
      signIn(OWNER_USER_ID);

      const first = await scan(
        new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ code: voucher.token, eventId }) }),
      );
      expect((await body(first)).data).toMatchObject({ result: "valid" });

      const second = await scan(
        new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ code: voucher.token, eventId }) }),
      );
      // A duplicate is an outcome the scanner renders, not a request failure.
      expect(second.status).toBe(200);
      expect((await body(second)).data).toMatchObject({ result: "duplicate" });
    });

    it("answers 200 with result:invalid for an unknown code", async () => {
      signIn(OWNER_USER_ID);
      const response = await scan(
        new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ code: "nonsense" }) }),
      );
      expect(response.status).toBe(200);
      expect((await body(response)).data).toMatchObject({ result: "invalid" });
    });

    it("denies a Viewer the scan endpoint (voucher:scan)", async () => {
      signIn(VIEWER_USER_ID);
      const response = await scan(
        new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ code: "x" }) }),
      );
      expect(response.status).toBe(403);
    });

    it("reverts a check-in for an Owner", async () => {
      const voucher = await seedVoucher({ status: "checked_in", checkedInAt: new Date() });
      signIn(OWNER_USER_ID);

      const response = await revertCheckIn(new Request("http://localhost/x", { method: "POST" }), {
        params: Promise.resolve({ voucherId: String(voucher._id) }),
      });
      expect((await body(response)).data).toMatchObject({ status: "active", checkedInAt: null });
    });
  });

  describe("org picker", () => {
    it("lists only the orgs a member belongs to", async () => {
      signIn(VIEWER_USER_ID);
      const response = await listOrgs();
      const payload = await body(response);

      expect((payload.data as Array<{ name: string }>).map((org) => org.name)).toEqual(["Sörfeszt Kft"]);
    });

    it("lists every org for a system admin, who may have no membership at all", async () => {
      signIn(OUTSIDER_USER_ID, { isSystemAdmin: true, activeOrganizationId: null });
      const response = await listOrgs();
      const names = ((await body(response)).data as Array<{ name: string }>).map((org) => org.name).sort();

      expect(names).toEqual(["Rival Kft", "Sörfeszt Kft"]);
    });

    it("sets the active org cookie after checking access", async () => {
      signIn(OWNER_USER_ID, { activeOrganizationId: null });
      const response = await setActiveOrg(
        new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ organizationId: orgId }) }),
      );
      expect(response.status).toBe(200);
      expect(cookieJar.get("tbook_active_org")).toBe(orgId);
    });

    it("refuses to set an org the user has no access to, and writes no cookie", async () => {
      signIn(OWNER_USER_ID, { activeOrganizationId: null });
      const response = await setActiveOrg(
        new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ organizationId: otherOrgId }) }),
      );
      expect(response.status).toBe(403);
      expect(cookieJar.has("tbook_active_org")).toBe(false);
    });

    it("clears the active org", async () => {
      cookieJar.set("tbook_active_org", orgId);
      signIn(OWNER_USER_ID);
      await clearActiveOrg();
      expect(cookieJar.get("tbook_active_org")).toBe("");
    });
  });

  describe("filter options", () => {
    it("returns the org's groups and events", async () => {
      signIn(OWNER_USER_ID);
      const payload = await body(await getFilterOptions());

      expect(payload.data).toMatchObject({
        groups: [{ id: groupId, name: "Sörfeszt 2026" }],
        events: [{ id: eventId, name: "Nyitónap" }],
      });
    });
  });
});
