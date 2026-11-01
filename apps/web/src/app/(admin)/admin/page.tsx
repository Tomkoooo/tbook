import Link from "next/link";
import { getOrganizationStats, listBookingsForOrg } from "@tbook/services";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { Stat, StatGrid } from "@/components/stat";
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
            <Button asChild>
              <Link href="/admin/bookings">All bookings</Link>
            </Button>
          ) : null
        }
      />

      {error === "missing-permission" ? (
        <Notice tone="warning">
          You don&apos;t have the <code className="font-mono">{permission}</code> permission needed for that page.
        </Notice>
      ) : null}

      <StatGrid>
        <Stat label="Groups" value={stats.groupCount} />
        <Stat label="Events" value={stats.eventCount} />
        <Stat label="Members" value={stats.memberCount} />
        {recent ? (
          <>
            <Stat label="Bookings" value={recent.total} hint={`${pendingCount} pending`} />
            <Stat label="Guests sold" value={recent.paidGuests} hint="paid + confirmed" />
            <Stat label="Revenue" value={formatRevenue(recent.revenueByCurrency)} hint="paid + confirmed" />
          </>
        ) : null}
      </StatGrid>

      {recent ? (
        <SectionCard
          title="Latest bookings"
          flush
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/bookings">
                View all <ArrowRight />
              </Link>
            </Button>
          }
        >
          {recent.bookings.length === 0 ? (
            <EmptyState
              title="No bookings yet"
              hint="Bookings made through the storefront or the public API will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booked</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead className="text-right">Guests</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.bookings.map((booking) => (
                  <TableRow key={String(booking._id)}>
                    <TableCell className="text-muted-foreground">{formatDateTime(booking.createdAt)}</TableCell>
                    <TableCell>
                      <Link className="font-medium hover:underline" href={`/admin/bookings/${String(booking._id)}`}>
                        {booking.customer?.name}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal">{booking.eventName}</TableCell>
                    <TableCell className="text-right">{booking.guests}</TableCell>
                    <TableCell className="text-right">{formatMoney(booking.totalHuf, booking.currency ?? "HUF")}</TableCell>
                    <TableCell>
                      <Badge variant={toneFor(BOOKING_STATUS_TONES, booking.status)}>{booking.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      ) : (
        <SectionCard title="Bookings">
          <p className="text-muted-foreground text-sm">
            You don&apos;t have permission to read this organization&apos;s bookings.
          </p>
        </SectionCard>
      )}
    </>
  );
}
