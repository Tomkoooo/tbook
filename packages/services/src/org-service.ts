import { Types, type Document } from "mongoose";
import { ActionError } from "@tbook/actions";
import {
  BookingModel,
  EventGroupModel,
  EventModel,
  OrganizationModel,
  OrgInviteModel,
  OrgRoleModel,
  eventGroupRepository,
  organizationRepository,
  orgInviteRepository,
  orgMembershipRepository,
  orgRoleRepository,
} from "@tbook/db";
import type { IOrgRole } from "@tbook/db";
import { apiKeyHint, generateApiKey, hashApiKey } from "./api-key";
import { TBOOK_OWNER_PERMISSIONS, TBOOK_VIEWER_PERMISSIONS, isTBookPermission } from "@tbook/schemas";
import type { MembershipStatus, Organization, OrgInvite, OrgMembership, OrgRole } from "@tbook/schemas";
import { generateInviteToken, hashInviteToken } from "./org-auth";

/** Repository writes take real Mongoose ObjectId fields; callers pass string ids. */
function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

/** Repository reads return Mongoose documents; entity types (from @tbook/schemas) want a plain `id` string. */
function toEntity<T extends { id: string }>(doc: Document): T {
  return { ...(doc.toObject() as object), id: String((doc as unknown as { _id: unknown })._id) } as T;
}

/**
 * Ported from the legacy plugin's services/org-service.ts, with two
 * deliberate behavior fixes (per the approved rebuild plan):
 *
 * 1. Built-in role permissions (Owner/Viewer) are seeded ONCE at org
 *    creation, never silently re-synced on every permission resolution —
 *    an admin who edits a built-in role's permissions keeps their edit.
 *    `resetRoleToBuiltInDefaults` is the explicit, opt-in way back to the
 *    shipped defaults.
 * 2. `createInvite` ALWAYS creates a real invite record with a token/expiry
 *    and requires an explicit `acceptInvite` step — the legacy version
 *    silently auto-joined an invited email that already had a User account,
 *    skipping the invite flow entirely. That asymmetry is gone here.
 *
 * Email delivery (invite emails) is intentionally NOT wired in here — the
 * legacy version imported a core MailerService that hasn't been ported yet.
 * `createInvite` returns the plaintext token so a caller (an apps/web
 * action, once mail sending exists) can send it; this is the extension
 * point for that follow-up work.
 */

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "org"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base);
  let suffix = 0;
  while (await OrganizationModel.exists({ slug })) {
    suffix += 1;
    slug = `${slugify(base)}-${suffix}`;
  }
  return slug;
}

async function seedBuiltInRoles(organizationId: string): Promise<IOrgRole> {
  const owner = await orgRoleRepository.create({
    organizationId: oid(organizationId),
    name: "Owner",
    description: "Full access to the organization.",
    permissions: TBOOK_OWNER_PERMISSIONS,
    isBuiltIn: true,
  });
  await orgRoleRepository.create({
    organizationId: oid(organizationId),
    name: "Viewer",
    description: "Read-only access.",
    permissions: TBOOK_VIEWER_PERMISSIONS,
    isBuiltIn: true,
  });
  return owner;
}

export interface CreateOrganizationInput {
  name: string;
  createdByUserId?: string | null;
  ownerUserId?: string | null;
  ownerEmail?: string | null;
  currency?: string;
}

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<{ organization: Organization; ownerRoleId: string; invite?: { inviteId: string; token: string } }> {
  const slug = await uniqueSlug(input.name);
  const organization = await OrganizationModel.create({
    name: input.name.trim(),
    slug,
    status: "active",
    settings: { currency: input.currency ?? "HUF" },
    createdBy: input.createdByUserId ? oid(input.createdByUserId) : null,
  });

  const ownerRole = await seedBuiltInRoles(String(organization._id));

  let invite: { inviteId: string; token: string } | undefined;
  if (input.ownerUserId) {
    await addMember({ organizationId: String(organization._id), userId: input.ownerUserId, roleIds: [String(ownerRole._id)] });
  } else if (input.ownerEmail?.trim()) {
    const created = await createInvite({ organizationId: String(organization._id), email: input.ownerEmail, roleIds: [String(ownerRole._id)] });
    invite = created;
  }

  return { organization: toEntity<Organization>(organization), ownerRoleId: String(ownerRole._id), invite };
}

export async function updateOrganization(id: string, patch: { name?: string; status?: "active" | "suspended"; currency?: string }): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.currency !== undefined) update["settings.currency"] = patch.currency;
  await organizationRepository.updateById(id, update);
}

/**
 * Dashboard counters for one org.
 *
 * Events and bookings are counted with the same organizationId-or-group
 * union the admin read models use, not a plain `{ organizationId }` match.
 * A plain match silently undercounts: real production events and bookings
 * exist with no `organizationId` field at all (see
 * scripts/migration-fixtures), so the dashboard would report fewer events
 * than the console's own lists show — which reads as data loss. Groups and
 * members always carry the org directly, so they need no union.
 */
export async function getOrganizationStats(organizationId: string) {
  const groups = await eventGroupRepository.findByOrganizationId(organizationId);
  const groupObjectIds = groups.map((group) => group._id);
  const scoped = { $or: [{ organizationId: oid(organizationId) }, { groupId: { $in: groupObjectIds } }] };

  const [eventCount, bookingCount, memberCount] = await Promise.all([
    EventModel.countDocuments(scoped),
    BookingModel.countDocuments(scoped),
    orgMembershipRepository.findByOrganizationId(organizationId).then((rows) => rows.filter((r) => r.status === "active").length),
  ]);
  return { groupCount: groups.length, eventCount, bookingCount, memberCount };
}

// ---- Members ----------------------------------------------------------

export interface AddMemberInput {
  organizationId: string;
  userId: string;
  roleIds: string[];
}

export async function addMember(input: AddMemberInput): Promise<OrgMembership> {
  const roleIds = input.roleIds.map(oid);
  const existing = await orgMembershipRepository.findByOrganizationAndUser(input.organizationId, input.userId);
  if (existing) {
    const updated = await orgMembershipRepository.updateById(String(existing._id), { roleIds, status: "active" });
    return toEntity<OrgMembership>(updated!);
  }
  const created = await orgMembershipRepository.create({
    organizationId: oid(input.organizationId),
    userId: oid(input.userId),
    roleIds,
    status: "active",
  });
  return toEntity<OrgMembership>(created);
}

export async function updateMember(input: { organizationId: string; membershipId: string; roleIds?: string[]; status?: MembershipStatus }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.roleIds) patch.roleIds = input.roleIds.map(oid);
  if (input.status) patch.status = input.status;
  const membership = await orgMembershipRepository.updateById(input.membershipId, patch);
  if (membership && String(membership.organizationId) !== input.organizationId) {
    throw ActionError.forbidden("Membership belongs to a different organization");
  }
}

export async function removeMember(organizationId: string, membershipId: string): Promise<void> {
  const memberships = await orgMembershipRepository.findByOrganizationId(organizationId);
  const membership = memberships.find((m) => String(m._id) === membershipId);
  if (!membership) throw ActionError.notFound("Membership not found");
  await orgMembershipRepository.updateById(membershipId, { status: "disabled" });
}

// ---- Roles --------------------------------------------------------------

export async function listRoles(organizationId: string): Promise<OrgRole[]> {
  const roles = await orgRoleRepository.findByOrganizationId(organizationId);
  return roles.map((r) => toEntity<OrgRole>(r));
}

export async function createRole(input: { organizationId: string; name: string; description?: string; permissions: string[] }): Promise<OrgRole> {
  const permissions = input.permissions.filter(isTBookPermission);
  const created = await orgRoleRepository.create({
    organizationId: oid(input.organizationId),
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    permissions,
    isBuiltIn: false,
  });
  return toEntity<OrgRole>(created);
}

export async function updateRole(input: { organizationId: string; roleId: string; name?: string; description?: string; permissions?: string[] }): Promise<void> {
  const role = await orgRoleRepository.findById(input.roleId);
  if (!role || String(role.organizationId) !== input.organizationId) throw ActionError.notFound("Role not found");
  if (role.isBuiltIn && input.name !== undefined && input.name !== role.name) {
    throw ActionError.validation("Built-in role names cannot be changed");
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.permissions !== undefined) patch.permissions = input.permissions.filter(isTBookPermission);
  await orgRoleRepository.updateById(input.roleId, patch);
}

/**
 * Explicit, opt-in reset of a built-in role's permissions back to the
 * shipped Owner/Viewer defaults — the ONLY place those defaults get
 * re-applied after org creation (see the module doc comment).
 */
export async function resetRoleToBuiltInDefaults(organizationId: string, roleId: string): Promise<void> {
  const role = await orgRoleRepository.findById(roleId);
  if (!role || String(role.organizationId) !== organizationId) throw ActionError.notFound("Role not found");
  if (!role.isBuiltIn) throw ActionError.validation("Only built-in roles can be reset to defaults");

  const defaults = role.name === "Owner" ? TBOOK_OWNER_PERMISSIONS : role.name === "Viewer" ? TBOOK_VIEWER_PERMISSIONS : null;
  if (!defaults) throw ActionError.validation(`Unknown built-in role: ${role.name}`);
  await orgRoleRepository.updateById(roleId, { permissions: defaults });
}

export async function deleteRole(organizationId: string, roleId: string): Promise<void> {
  const role = await orgRoleRepository.findById(roleId);
  if (!role || String(role.organizationId) !== organizationId) throw ActionError.notFound("Role not found");
  if (role.isBuiltIn) throw ActionError.validation("Built-in roles cannot be deleted");

  const memberships = await orgMembershipRepository.findByOrganizationId(organizationId);
  const inUse = memberships.some((m) => m.roleIds.some((id) => String(id) === roleId));
  if (inUse) throw ActionError.validation("This role is still assigned to members — remove it from them first");

  await OrgRoleModel.deleteOne({ _id: roleId });
}

// ---- Invites --------------------------------------------------------------

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function listInvites(organizationId: string): Promise<OrgInvite[]> {
  const now = new Date();
  const invites = await OrgInviteModel.find({ organizationId, acceptedAt: null, expiresAt: { $gt: now } })
    .sort({ createdAt: -1 })
    .exec();
  return invites.map((i) => toEntity<OrgInvite>(i));
}

/**
 * Always creates a real invite record (tokenHash + 7-day expiry) regardless
 * of whether the email already has an account — see the module doc comment
 * for why this differs from the legacy behavior.
 */
export async function createInvite(input: { organizationId: string; email: string; roleIds: string[]; invitedByUserId?: string | null }): Promise<{ inviteId: string; token: string }> {
  const email = input.email.trim().toLowerCase();
  const org = await organizationRepository.findById(input.organizationId);
  if (!org) throw ActionError.notFound("Organization not found");

  const token = generateInviteToken();
  const invite = await orgInviteRepository.create({
    organizationId: oid(input.organizationId),
    email,
    roleIds: input.roleIds.map(oid),
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    invitedBy: input.invitedByUserId ? oid(input.invitedByUserId) : null,
  });

  return { inviteId: String(invite._id), token };
}

/** Explicit accept step — the only way an invite turns into a membership. */
export async function acceptInvite(token: string, userId: string, userEmail: string): Promise<string> {
  const tokenHash = hashInviteToken(token);
  const invite = await orgInviteRepository.findByTokenHash(tokenHash);
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= Date.now()) {
    throw ActionError.notFound("Invite not found or expired");
  }

  const email = userEmail.trim().toLowerCase();
  if (invite.email !== email) throw ActionError.forbidden("This invite was sent to a different email address");

  await addMember({ organizationId: String(invite.organizationId), userId, roleIds: invite.roleIds.map(String) });
  await orgInviteRepository.updateById(String(invite._id), { acceptedAt: new Date() });
  return String(invite.organizationId);
}

export async function listOrganizationsForUser(userId: string): Promise<Array<{ id: string; name: string; slug: string }>> {
  const memberships = await orgMembershipRepository.findByUserId(userId);
  const orgIds = memberships.map((m) => String(m.organizationId));
  if (orgIds.length === 0) return [];
  const orgs = await OrganizationModel.find({ _id: { $in: orgIds }, status: "active" }).sort({ name: 1 }).exec();
  return orgs.map((org) => ({ id: String(org._id), name: org.name, slug: org.slug }));
}

export async function getOwnerRoleId(organizationId: string): Promise<string | null> {
  const roles = await orgRoleRepository.findByOrganizationId(organizationId);
  const owner = roles.find((r) => r.name === "Owner" && r.isBuiltIn);
  return owner ? String(owner._id) : null;
}

/** Default role for new members when none is selected (Viewer, else first role). */
export async function getDefaultMemberRoleIds(organizationId: string): Promise<string[]> {
  const roles = await orgRoleRepository.findByOrganizationId(organizationId);
  const viewer = roles.find((r) => r.name === "Viewer" && r.isBuiltIn);
  if (viewer) return [String(viewer._id)];
  return roles[0] ? [String(roles[0]._id)] : [];
}

// ---- Event-group API keys --------------------------------------------------

export async function rotateGroupApiKey(groupId: string): Promise<{ plaintext: string }> {
  const plaintext = generateApiKey();
  const updated = await EventGroupModel.findByIdAndUpdate(
    groupId,
    { apiKeyHash: hashApiKey(plaintext), apiKeyHint: apiKeyHint(plaintext), apiKeyCreatedAt: new Date() },
    { returnDocument: "after" },
  ).exec();
  if (!updated) throw ActionError.notFound("Event group not found");
  return { plaintext };
}
