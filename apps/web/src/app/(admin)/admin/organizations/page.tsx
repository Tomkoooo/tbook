import { redirect } from "next/navigation";
import { getOrganizationStats, listAllOrganizations } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { getSessionUser } from "@/lib/admin-auth";
import { formatDate } from "@/lib/admin-page";
import { getActiveOrganizationIdFromCookie } from "@/lib/org-cookie";
import { CreateOrganizationForm, OrganizationRowActions } from "./organization-controls";

/**
 * Platform view for system admins: every organization, plus creating one.
 * Not org-scoped, so it works before any organization exists.
 */
export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/signin?callbackUrl=/admin/organizations");
  if (!user.isSystemAdmin) redirect("/admin?error=missing-permission&permission=system-admin");

  const [organizations, activeId] = await Promise.all([listAllOrganizations(), getActiveOrganizationIdFromCookie()]);
  const stats = await Promise.all(organizations.map((org) => getOrganizationStats(org.id)));

  return (
    <>
      <PageTitle title="Organizations" description="Every organization on this tBook installation. Only system admins see this page." />

      <CreateOrganizationForm />

      <SectionCard title={`All organizations (${organizations.length})`} flush>
        {organizations.length === 0 ? (
          <EmptyState title="No organizations yet" hint="Create the first one above." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Bookings</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((org, index) => (
                <TableRow key={org.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {org.name}
                      {org.id === activeId ? <Badge variant="info">current</Badge> : null}
                    </div>
                    <div className="text-muted-foreground font-mono text-xs">{org.slug}</div>
                  </TableCell>
                  <TableCell className="text-right">{stats[index]?.memberCount ?? 0}</TableCell>
                  <TableCell className="text-right">{stats[index]?.eventCount ?? 0}</TableCell>
                  <TableCell className="text-right">{stats[index]?.bookingCount ?? 0}</TableCell>
                  <TableCell className="text-muted-foreground">{org.createdAt ? formatDate(org.createdAt) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={org.status === "active" ? "success" : "warning"}>{org.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <OrganizationRowActions organizationId={org.id} status={org.status as "active" | "suspended"} isCurrent={org.id === activeId} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
