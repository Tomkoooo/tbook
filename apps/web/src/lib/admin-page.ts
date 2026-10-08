import { redirect } from "next/navigation";
import { organizationRepository } from "@tbook/db";
import { resolveMembershipPermissions } from "@tbook/services";
import type { Permission } from "@tbook/schemas";
import { getSessionUser, type SessionUser } from "./admin-auth";
import { getActiveOrganizationIdFromCookie } from "./org-cookie";

/**
 * Page-level counterpart to admin-auth's requireOrgPermission. Server
 * *pages* want a redirect ("go sign in", "go pick an org"), not the
 * ActionError a route handler maps to an HTTP status — so this resolves
 * access without throwing and redirects on each failure mode.
 *
 * Structured so Next's `redirect()` is never called inside a try block:
 * redirect() signals by throwing, and catching it would swallow the
 * navigation. resolveOrgAccess therefore returns null on denial instead of
 * throwing, and every redirect happens at the top level.
 */

export interface AdminPageContext {
  user: SessionUser;
  organizationId: string;
  organizationName: string;
  permissions: Set<Permission>;
  isSystemAdmin: boolean;
}

/** Returns null (never throws) when the user may not act in this org. */
async function resolveOrgAccess(
  user: SessionUser,
  organizationId: string,
): Promise<{ organizationName: string; permissions: Set<Permission> } | null> {
  const org = await organizationRepository.findById(organizationId);
  if (!org || org.status === "suspended") return null;

  if (user.isSystemAdmin) {
    // Mirrors requireOrgPermission: a system admin bypasses the permission
    // catalog entirely, so it gets the full set for UI-gating purposes.
    const { TBOOK_OWNER_PERMISSIONS } = await import("@tbook/schemas");
    return { organizationName: org.name, permissions: new Set(TBOOK_OWNER_PERMISSIONS) };
  }

  const membership = await resolveMembershipPermissions(organizationId, user.id);
  if (!membership) return null;
  return { organizationName: org.name, permissions: membership.permissions };
}

/**
 * Resolves the signed-in admin's org context, optionally requiring one
 * permission. Redirects to sign-in, to the org picker, or back to the
 * dashboard (for a permission the user lacks) as appropriate.
 */
export async function requireAdminPage(permission?: Permission): Promise<AdminPageContext> {
  const user = await getSessionUser();
  if (!user) redirect("/auth/signin?callbackUrl=/admin");

  const organizationId = user.activeOrganizationId ?? (await getActiveOrganizationIdFromCookie());
  if (!organizationId) redirect("/admin/select-org");

  const access = await resolveOrgAccess(user, organizationId);
  if (!access) redirect("/admin/select-org?error=no-access");

  if (permission && !access.permissions.has(permission)) {
    redirect(`/admin?error=missing-permission&permission=${encodeURIComponent(permission)}`);
  }

  return {
    user,
    organizationId,
    organizationName: access.organizationName,
    permissions: access.permissions,
    isSystemAdmin: user.isSystemAdmin,
  };
}

/** Formats a HUF amount the way the whole console shows money. */
export function formatHuf(amount: number, currency = "HUF"): string {
  return new Intl.NumberFormat("hu-HU", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

/** Formats a timestamp for the console's tables (local, minute precision). */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("hu-HU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium" }).format(new Date(value));
}
