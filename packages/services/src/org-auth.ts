import crypto from "node:crypto";
import { ActionError } from "@tbook/actions";
import { organizationRepository, orgMembershipRepository, orgRoleRepository } from "@tbook/db";
import type { Permission } from "@tbook/schemas";

/**
 * Ported from the legacy plugin's lib/org-auth.ts, minus anything tied to
 * the NextAuth session / cookie (that's an apps/web concern in a later
 * phase). System-admin status can't be resolved here either — the User
 * model isn't ported yet — so it's an explicit boolean the caller supplies
 * (e.g. resolved from the session in apps/web), not looked up internally.
 */

export interface OrgAuthContext {
  userId: string;
  organizationId: string;
  permissions: Set<Permission>;
  membershipId: string;
}

/**
 * Union of permissions across every active role a user holds in an org.
 * Deliberate fix vs. the legacy version: it called syncBuiltInRolePermissions
 * here, silently overwriting Owner/Viewer permissions on every resolution
 * (can clobber an admin's edits). That sync only happens at org creation now
 * (see org-service.ts's createOrganization) and via the explicit
 * resetRoleToBuiltInDefaults action — never implicitly on read.
 */
export async function resolveMembershipPermissions(
  organizationId: string,
  userId: string,
): Promise<{ permissions: Set<Permission>; membershipId: string } | null> {
  const membership = await orgMembershipRepository.findByOrganizationAndUser(organizationId, userId);
  if (!membership || membership.status !== "active") return null;

  const roles = await orgRoleRepository.findByIds(membership.roleIds.map(String));
  const permissions = new Set<Permission>();
  for (const role of roles) {
    for (const perm of role.permissions) permissions.add(perm);
  }

  return { permissions, membershipId: String(membership._id) };
}

/** Validates that a user may activate the given org (member, or caller-asserted system admin). */
export async function assertUserOrganizationAccess(
  userId: string,
  organizationId: string,
  opts: { isSystemAdmin?: boolean } = {},
): Promise<void> {
  const org = await organizationRepository.findById(organizationId);
  if (!org) throw ActionError.notFound("Organization not found");
  if (org.status === "suspended") throw ActionError.forbidden("Organization is suspended");
  if (opts.isSystemAdmin) return;

  const membership = await resolveMembershipPermissions(organizationId, userId);
  if (!membership) throw ActionError.forbidden("You do not have access to this organization");
}

/**
 * Resolves the auth context and enforces a single permission. System admins
 * (asserted by the caller, e.g. from the session) bypass the permission
 * check entirely, matching the legacy behavior.
 */
export async function requireOrgPermission(
  permission: Permission,
  input: { userId: string; organizationId: string; isSystemAdmin?: boolean },
): Promise<OrgAuthContext> {
  if (!input.userId) throw ActionError.unauthorized();
  if (!input.organizationId) throw ActionError.forbidden("Select an organization to continue");

  const org = await organizationRepository.findById(input.organizationId);
  if (!org) throw ActionError.notFound("Organization not found");
  if (org.status === "suspended") throw ActionError.forbidden("Organization is suspended");

  if (input.isSystemAdmin) {
    return { userId: input.userId, organizationId: input.organizationId, permissions: new Set(), membershipId: "" };
  }

  const membership = await resolveMembershipPermissions(input.organizationId, input.userId);
  if (!membership) throw ActionError.forbidden("You do not have access to this organization");
  if (!membership.permissions.has(permission)) throw ActionError.forbidden("You do not have permission for this action");

  return { userId: input.userId, organizationId: input.organizationId, permissions: membership.permissions, membershipId: membership.membershipId };
}

export function orgScopeFilter(organizationId: string): { organizationId: string } {
  return { organizationId };
}

export function assertResourceInOrg(organizationId: string, resourceOrgId: string | null | undefined): void {
  if (!resourceOrgId) throw ActionError.notFound("Resource does not belong to an organization");
  if (String(resourceOrgId) !== organizationId) throw ActionError.forbidden("Resource belongs to a different organization");
}

export function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}
