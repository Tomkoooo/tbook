import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/admin-auth";
import { getActiveOrganizationIdFromCookie } from "@/lib/org-cookie";
import { organizationRepository } from "@tbook/db";
import { resolveMembershipPermissions } from "@tbook/services";
import { TBOOK_OWNER_PERMISSIONS } from "@tbook/schemas";
import { AdminNav } from "./admin-nav";

/**
 * Admin console shell. Gates on a signed-in session only — the *org*
 * requirement is enforced per page by requireAdminPage, because the org
 * picker itself lives under /admin and a layout-level org gate would
 * redirect it to itself in a loop.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/signin?callbackUrl=/admin");
  }

  if (!user.isSystemAdmin && user.organizationIds.length === 0) {
    return (
      <main className="tbook-centered">
        <h1>No organization access</h1>
        <p className="tbook-muted">
          Your account isn&apos;t a member of any organization yet. Ask an org admin to invite you.
        </p>
      </main>
    );
  }

  const activeOrgId = user.activeOrganizationId ?? (await getActiveOrganizationIdFromCookie());
  const activeOrg = activeOrgId ? await organizationRepository.findById(activeOrgId) : null;

  // Resolved here only to decide which nav links to show. A system admin
  // bypasses the permission catalog (same rule as requireOrgPermission), so
  // it gets the full set.
  const permissions = !activeOrgId
    ? []
    : user.isSystemAdmin
      ? [...TBOOK_OWNER_PERMISSIONS]
      : [...((await resolveMembershipPermissions(activeOrgId, user.id))?.permissions ?? [])];

  return (
    <div className="tbook-admin">
      <AdminNav
        organizationName={activeOrg?.name ?? null}
        userEmail={user.email}
        isSystemAdmin={user.isSystemAdmin}
        permissions={permissions}
      />
      <main className="tbook-admin-main">{children}</main>
    </div>
  );
}
