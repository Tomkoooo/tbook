import { MongoMemoryServer } from "mongodb-memory-server";
import { OrgInviteModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { TBOOK_OWNER_PERMISSIONS, TBOOK_VIEWER_PERMISSIONS } from "@tbook/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveMembershipPermissions } from "./org-auth";
import {
  acceptInvite,
  addMember,
  createInvite,
  createOrganization,
  createRole,
  deleteRole,
  getDefaultMemberRoleIds,
  getOrganizationStats,
  getOwnerRoleId,
  listInvites,
  listRoles,
  removeMember,
  resetRoleToBuiltInDefaults,
  rotateGroupApiKey,
  updateRole,
} from "./org-service";

describe("org-service", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });

  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  beforeEach(async () => {
    const { OrganizationModel, EventGroupModel, OrgMembershipModel, OrgRoleModel } = await import("@tbook/db");
    await Promise.all([
      OrganizationModel.deleteMany({}),
      EventGroupModel.deleteMany({}),
      OrgMembershipModel.deleteMany({}),
      OrgRoleModel.deleteMany({}),
      OrgInviteModel.deleteMany({}),
    ]);
  });

  it("seeds built-in Owner/Viewer roles with the full permission catalogs on creation", async () => {
    const { organization } = await createOrganization({ name: "Sörfeszt" });
    const roles = await listRoles(organization.id);
    const owner = roles.find((r) => r.name === "Owner");
    const viewer = roles.find((r) => r.name === "Viewer");
    expect(owner?.permissions.sort()).toEqual([...TBOOK_OWNER_PERMISSIONS].sort());
    expect(viewer?.permissions.sort()).toEqual([...TBOOK_VIEWER_PERMISSIONS].sort());
  });

  it("adds the immediate owner as a member when ownerUserId is given, no invite created", async () => {
    const userId = "6a574d05da17ae33cc2b5517";
    const { organization, invite } = await createOrganization({ name: "WDF", ownerUserId: userId });
    expect(invite).toBeUndefined();
    const permissions = await resolveMembershipPermissions(organization.id, userId);
    expect(permissions?.permissions.has("booking:manage")).toBe(true);
  });

  it("fix 1: built-in role permission edits survive further permission resolution (no silent re-sync)", async () => {
    const { organization } = await createOrganization({ name: "Custom Perms Org" });
    const roles = await listRoles(organization.id);
    const owner = roles.find((r) => r.name === "Owner")!;

    await updateRole({ organizationId: organization.id, roleId: owner.id, permissions: ["org:read"] });

    const userId = "6a574d05da17ae33cc2b5518";
    await addMember({ organizationId: organization.id, userId, roleIds: [owner.id] });

    // Resolving permissions (as any auth check would) must NOT clobber the edit back to full Owner perms.
    const resolved = await resolveMembershipPermissions(organization.id, userId);
    expect([...(resolved?.permissions ?? [])]).toEqual(["org:read"]);

    // The explicit reset action is the only way back to defaults.
    await resetRoleToBuiltInDefaults(organization.id, owner.id);
    const afterReset = await resolveMembershipPermissions(organization.id, userId);
    expect(afterReset?.permissions.size).toBe(TBOOK_OWNER_PERMISSIONS.length);
  });

  it("built-in roles cannot be renamed or deleted", async () => {
    const { organization } = await createOrganization({ name: "Locked Roles Org" });
    const roles = await listRoles(organization.id);
    const owner = roles.find((r) => r.name === "Owner")!;

    await expect(updateRole({ organizationId: organization.id, roleId: owner.id, name: "Not Owner" })).rejects.toThrow();
    await expect(deleteRole(organization.id, owner.id)).rejects.toThrow();
  });

  it("fix 2: createInvite always creates a real invite record + token, regardless of any prior membership", async () => {
    const { organization } = await createOrganization({ name: "Invite Org" });
    const roleIds = await getDefaultMemberRoleIds(organization.id);

    // Simulate "this email already has an account" by nothing more than calling createInvite twice —
    // the point of the fix is there is no special-cased auto-join path at all, so behavior is
    // identical and always produces a real, acceptable invite.
    const first = await createInvite({ organizationId: organization.id, email: "person@example.com", roleIds });
    expect(first.inviteId).toBeTruthy();
    expect(first.token).toBeTruthy();

    const stored = await OrgInviteModel.findById(first.inviteId).exec();
    expect(stored?.acceptedAt).toBeNull();
    expect(stored?.tokenHash).toBeTruthy();
    expect(stored?.tokenHash).not.toBe(first.token); // hash stored, not plaintext

    const invites = await listInvites(organization.id);
    expect(invites.some((i) => i.id === first.inviteId)).toBe(true);
  });

  it("acceptInvite requires an explicit step and enforces the email match", async () => {
    const { organization } = await createOrganization({ name: "Accept Org" });
    const roleIds = await getDefaultMemberRoleIds(organization.id);
    const { token } = await createInvite({ organizationId: organization.id, email: "invitee@example.com", roleIds });

    await expect(acceptInvite(token, "6a574d05da17ae33cc2b5519", "wrong@example.com")).rejects.toThrow();

    const orgId = await acceptInvite(token, "6a574d05da17ae33cc2b5519", "invitee@example.com");
    expect(orgId).toBe(organization.id);

    const permissions = await resolveMembershipPermissions(organization.id, "6a574d05da17ae33cc2b5519");
    expect(permissions).not.toBeNull();

    // Re-accepting the same (now-used) token must fail.
    await expect(acceptInvite(token, "6a574d05da17ae33cc2b5519", "invitee@example.com")).rejects.toThrow();
  });

  it("owner role id and default member role id resolve correctly", async () => {
    const { organization } = await createOrganization({ name: "Role Lookup Org" });
    const ownerRoleId = await getOwnerRoleId(organization.id);
    const defaultRoleIds = await getDefaultMemberRoleIds(organization.id);
    expect(ownerRoleId).toBeTruthy();
    expect(defaultRoleIds).toHaveLength(1);
    expect(defaultRoleIds[0]).not.toBe(ownerRoleId); // defaults to Viewer, not Owner

    const custom = await createRole({ organizationId: organization.id, name: "Scanner", permissions: ["voucher:scan"] });
    expect(custom.permissions).toEqual(["voucher:scan"]);
  });

  it("removeMember disables (not deletes) the membership", async () => {
    const { organization } = await createOrganization({ name: "Remove Member Org" });
    const roleIds = await getDefaultMemberRoleIds(organization.id);
    const membership = await addMember({ organizationId: organization.id, userId: "6a574d05da17ae33cc2b551a", roleIds });

    await removeMember(organization.id, membership.id);
    const permissions = await resolveMembershipPermissions(organization.id, "6a574d05da17ae33cc2b551a");
    expect(permissions).toBeNull();
  });

  it("rotates an event group's API key, invalidating the old hash", async () => {
    const { EventGroupModel } = await import("@tbook/db");
    const group = await EventGroupModel.create({
      name: "WDF 2027",
      apiKeyHash: "old-hash",
      apiKeyHint: "tbk_old…0000",
      apiKeyCreatedAt: new Date(),
    });

    const { plaintext } = await rotateGroupApiKey(String(group._id));
    expect(plaintext.startsWith("tbk_")).toBe(true);

    const updated = await EventGroupModel.findById(group._id).exec();
    expect(updated?.apiKeyHash).not.toBe("old-hash");
  });

  describe("getOrganizationStats", () => {
    it("counts events and bookings that carry no organizationId, via the org's groups", async () => {
      const { organization } = await createOrganization({ name: "Sörfeszt" });
      const { EventGroupModel, EventModel, BookingModel } = await import("@tbook/db");

      const group = await EventGroupModel.create({
        name: "Sörfeszt 2026",
        organizationId: organization.id,
        status: "active",
        apiKeyHash: "hash",
        apiKeyHint: "tbk_xxxx",
        apiKeyCreatedAt: new Date(),
      });

      const baseEvent = {
        groupId: group._id,
        status: "active" as const,
        startDate: new Date("2026-07-01"),
        endDate: new Date("2026-07-02"),
        ticketFeeHuf: 5000,
      };
      await EventModel.create({ ...baseEvent, name: "Tagged", organizationId: organization.id });
      // Production drift: no organizationId field at all. A plain
      // { organizationId } count would miss it and the dashboard would
      // report fewer events than the console's own event list shows.
      await EventModel.create({ ...baseEvent, name: "Legacy" });

      const baseBooking = {
        groupId: group._id,
        eventId: baseEvent.groupId,
        eventName: "Tagged",
        customer: { name: "A", email: "a@example.com", phone: "+1" },
        guests: 1,
        quote: { guests: 1, ticketSubtotalHuf: 1, totalHuf: 1 },
        totalHuf: 1,
      };
      await BookingModel.create({ ...baseBooking, organizationId: organization.id });
      await BookingModel.create({ ...baseBooking, organizationId: null });

      const stats = await getOrganizationStats(organization.id);
      expect(stats.groupCount).toBe(1);
      expect(stats.eventCount).toBe(2);
      expect(stats.bookingCount).toBe(2);
    });

    it("does not count another org's events", async () => {
      const { organization } = await createOrganization({ name: "Mine" });
      const { organization: other } = await createOrganization({ name: "Theirs" });
      const { EventGroupModel, EventModel } = await import("@tbook/db");

      const otherGroup = await EventGroupModel.create({
        name: "Theirs 2026",
        organizationId: other.id,
        status: "active",
        apiKeyHash: "hash2",
        apiKeyHint: "tbk_yyyy",
        apiKeyCreatedAt: new Date(),
      });
      await EventModel.create({
        groupId: otherGroup._id,
        name: "Not mine",
        status: "active",
        startDate: new Date("2026-07-01"),
        endDate: new Date("2026-07-02"),
        ticketFeeHuf: 1000,
      });

      expect((await getOrganizationStats(organization.id)).eventCount).toBe(0);
    });
  });
});
