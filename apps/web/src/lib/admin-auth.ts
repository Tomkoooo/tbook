import { ActionError } from "@tbook/actions";
import { auth } from "@/auth";
import { requireOrgPermission as requireOrgPermissionService, type OrgAuthContext } from "@tbook/services";
import type { Permission } from "@tbook/schemas";
import { getActiveOrganizationIdFromCookie } from "./org-cookie";

/**
 * Request-level auth helpers wrapping NextAuth's `auth()` + @tbook/services'
 * org-auth primitives (which deliberately take userId/isSystemAdmin as
 * explicit inputs rather than resolving a session themselves — this file is
 * where the session actually gets turned into those inputs).
 */

export interface SessionUser {
  id: string;
  email: string | null;
  isSystemAdmin: boolean;
  organizationIds: string[];
  activeOrganizationId?: string;
}

/** Returns the signed-in user, or null if there's no session. Does not throw. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    isSystemAdmin: session.user.isSystemAdmin === true,
    organizationIds: session.user.organizationIds ?? [],
    activeOrganizationId: session.user.activeOrganizationId,
  };
}

/** Throws 401 if there's no session, 403 if the user has no active organization selected. */
export async function requireOrgContext(): Promise<{ userId: string; organizationId: string; isSystemAdmin: boolean }> {
  const user = await getSessionUser();
  if (!user) throw ActionError.unauthorized();

  const organizationId = user.activeOrganizationId ?? (await getActiveOrganizationIdFromCookie()) ?? undefined;
  if (!organizationId) throw ActionError.forbidden("Select an organization to continue");

  return { userId: user.id, organizationId, isSystemAdmin: user.isSystemAdmin };
}

/** Resolves the org auth context and enforces a single permission (system admins bypass). */
export async function requireOrgPermission(permission: Permission): Promise<OrgAuthContext> {
  const { userId, organizationId, isSystemAdmin } = await requireOrgContext();
  return requireOrgPermissionService(permission, { userId, organizationId, isSystemAdmin });
}

/** Throws 401/403 unless the signed-in user is a platform system admin. */
export async function requireSystemAdmin(): Promise<{ userId: string }> {
  const user = await getSessionUser();
  if (!user) throw ActionError.unauthorized();
  if (!user.isSystemAdmin) throw ActionError.forbidden("System admin access required");
  return { userId: user.id };
}
