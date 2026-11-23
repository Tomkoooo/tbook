import Link from "next/link";
import { getOrganizationStats, listBookingsForOrg } from "@tbook/services";
import { CalendarDays, Clock, CreditCard, FolderTree, Plus, Ticket, Users, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTable } from "@/components/simple-table";
import { EmptyState } from "@/components/empty-state";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { Panel } from "@/components/panel";
import { BOOKING_STATUS_TONES, toneFor } from "@/lib/status-tones";
import { formatDateTime, formatMoney, formatRevenue, requireAdminPage } from "@/lib/admin-page";

/**
 * Org dashboard (legacy: the admin home resolver's landing view). Reads
 * through the services directly as a server component — no client fetch
 * layer, so the first paint already has the data and there is no
 * loading-state triad to maintain.
 */
export const dynamic = "force-dynamic";

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; permission?: string }>;
}) {
  const { organizationId, organizationName, permissions } = await requireAdminPage();
  const { error, permission } = await searchParams;

  const canReadBookings = permissions.has("booking:read");

  const [stats, recent] = await Promise.all([
    getOrganizationStats(organizationId),
    canReadBookings
      ? listBookingsForOrg(organizationId, { pageSize: 8 })
      : Promise.resolve(null),
  ]);

  // statusTotals is per status *and* currency, so a status can appear more
  // than once — count across all of its rows rather than picking the first.
  const pendingCount = (recent?.statusTotals ?? [])
    .filter((row) => row.status === "pending")
    .reduce((sum, row) => sum + row.count, 0);

  return (
    <>
      <PageTitle
        title={organizationName}
        description="Overview of this organization's events and bookings."
        actions={
          canReadBookings ? (
            <>
              <Button variant="outline" asChild>
                <Link href="/admin/bookings">All bookings</Link>
              </Button>
              {permissions.has("booking:manage") && permissions.has("event:read") ? (
                // A registration belongs to an event: pick it, then Guests › New registration.
                <Button asChild>
                  <Link href="/admin/events">
                    <Plus /> Register a guest
                  </Link>
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {error === "missing-permission" ? (
        <Notice tone="warning">
          You don&apos;t have the <code className="font-mono">{permission}</code> permission needed for that page.
        </Notice>
      ) : null}

      {recent && pendingCount > 0 ? (
        <Notice
          tone="warning"
          title={`${pendingCount} pending booking${pendingCount === 1 ? "" : "s"}`}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/bookings?status=pending">Review pending</Link>
            </Button>
          }
        >
          These are waiting for payment or confirmation.
        </Notice>
      ) : null}

      <KpiGrid cols={recent ? 4 : 3}>
        {recent ? (
          <>
            <KpiTile
              label="Revenue"
              value={formatRevenue(recent.revenueByCurrency)}
              hint="paid + confirmed"
              tone="success"
              icon={<Wallet />}
              href="/admin/bookings"
            />
            <KpiTile
              label="Bookings"
              value={recent.total}
              hint={`${pendingCount} pending`}
              tone={pendingCount > 0 ? "warning" : "info"}
              icon={<CreditCard />}
              href="/admin/bookings"
            />
            <KpiTile label="Guests sold" value={recent.paidGuests} hint="paid + confirmed" tone="info" icon={<Ticket />} />
          </>
        ) : null}
        <KpiTile
          label="Events"
          value={stats.eventCount}
          icon={<CalendarDays />}
          href={permissions.has("event:read") ? "/admin/events" : undefined}
        />
        <KpiTile
          label="Groups"
          value={stats.groupCount}
          icon={<FolderTree />}
          href={permissions.has("group:read") ? "/admin/groups" : undefined}
        />
        <KpiTile
          label="Members"
          value={stats.memberCount}
          icon={<Users />}
          href={permissions.has("member:read") ? "/admin/members" : undefined}
        />
      </KpiGrid>

      {recent ? (
        <Panel title="Latest bookings" description="The eight most recent, newest first." href="/admin/bookings" flush>
          <SimpleTable
            rows={recent.bookings}
            rowKey={(booking) => String(booking._id)}
            mobileCards
            caption="Latest bookings"
            empty={
              <EmptyState
                icon={<Clock />}
                title="No bookings yet"
                hint="Bookings made through the storefront or the public API will appear here."
              />
            }
            columns={[
              {
                key: "customer",
                header: "Customer",
                mobile: "title",
                cell: (booking) => (
                  <Link className="font-medium hover:underline" href={`/admin/bookings/${String(booking._id)}`}>
                    {booking.customer?.name}
                  </Link>
                ),
              },
              {
                key: "booked",
                header: "Booked",
                className: "text-muted-foreground",
                cell: (booking) => formatDateTime(booking.createdAt),
              },
              { key: "event", header: "Event", wrap: true, hideBelow: "md", cell: (booking) => booking.eventName },
              { key: "guests", header: "Guests", align: "right", cell: (booking) => booking.guests },
              {
                key: "total",
                header: "Total",
                align: "right",
                cell: (booking) => formatMoney(booking.totalHuf, booking.currency ?? "HUF"),
              },
              {
                key: "status",
                header: "Status",
                cell: (booking) => (
                  <Badge variant={toneFor(BOOKING_STATUS_TONES, booking.status)}>{booking.status}</Badge>
                ),
              },
            ]}
          />
        </Panel>
      ) : (
        <Panel title="Bookings">
          <p className="text-muted-foreground text-sm">
            You don&apos;t have permission to read this organization&apos;s bookings.
          </p>
        </Panel>
      )}
    </>
  );
}
