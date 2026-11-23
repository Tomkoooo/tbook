import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/admin-auth";
import { getActiveOrganizationIdFromCookie } from "@/lib/org-cookie";
import { organizationRepository } from "@tbook/db";
import { resolveMembershipPermissions } from "@tbook/services";
import { TBOOK_OWNER_PERMISSIONS } from "@tbook/schemas";
import { WorkspaceSeed } from "@/components/shell/workspace-store";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { workspaceSeedForPath } from "@/lib/workspace-nav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminHeader } from "./admin-header";
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
      <main className="flex min-h-svh items-center justify-center p-4">
        <div className="bg-card grid max-w-sm gap-2 rounded-xl border p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">No organization access</h1>
          <p className="text-muted-foreground text-sm">
            Your account isn&apos;t a member of any organization yet. Ask an org admin to invite you.
          </p>
        </div>
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

  const orgModules = Object.entries((activeOrg?.modules ?? {}) as Record<string, { enabled?: boolean }>)
    .filter(([, state]) => state?.enabled)
    .map(([key]) => key);

  // The event/group the URL is in, resolved here so the sidebar and breadcrumbs render complete on the first paint.
  const pathname = (await headers()).get("x-tbook-pathname") ?? "";
  const seed = activeOrgId && permissions.length > 0 ? await workspaceSeedForPath(activeOrgId, permissions, pathname) : null;

  return (
    <TooltipProvider>
      <WorkspaceSeed info={seed}>
      <SidebarProvider>
        <AdminNav
          organizationName={activeOrg?.name ?? null}
          userEmail={user.email}
          isSystemAdmin={user.isSystemAdmin}
          permissions={permissions}
          modules={orgModules}
        />
        <SidebarInset>
          <AdminHeader permissions={permissions} modules={orgModules} isSystemAdmin={user.isSystemAdmin} />
          <main className="mx-auto flex w-full min-w-0 max-w-[1440px] flex-col gap-6 p-4 pb-16 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
      </WorkspaceSeed>
    </TooltipProvider>
  );
}
