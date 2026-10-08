import Link from "next/link";
import { getOrganizationStats, listBookingsForOrg } from "@tbook/services";
import {
  BOOKING_STATUS_TONES,
  Badge,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Stat,
  StatRow,
  Table,
} from "@tbook/ui";
import { formatDateTime, formatHuf, requireAdminPage } from "@/lib/admin-page";

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

  const paid = recent?.statusTotals.find((row) => row.status === "paid");
  const confirmed = recent?.statusTotals.find((row) => row.status === "confirmed");
  const pending = recent?.statusTotals.find((row) => row.status === "pending");
  const guestsSold = (paid?.guests ?? 0) + (confirmed?.guests ?? 0);

  return (
    <>
      <PageHeader
        title={organizationName}
        description="Overview of this organization's events and bookings."
        actions={
          canReadBookings ? (
            <Link className="tbook-btn tbook-btn-primary" href="/admin/bookings">
              All bookings
            </Link>
          ) : null
        }
      />

      {error === "missing-permission" ? (
        <Notice tone="warning">
          You don&apos;t have the <code>{permission}</code> permission needed for that page.
        </Notice>
      ) : null}

      <StatRow>
        <Stat label="Groups" value={stats.groupCount} />
        <Stat label="Events" value={stats.eventCount} />
        <Stat label="Members" value={stats.memberCount} />
        {recent ? (
          <>
            <Stat label="Bookings" value={recent.total} hint={`${pending?.count ?? 0} pending`} />
            <Stat label="Guests sold" value={guestsSold} hint="paid + confirmed" />
            <Stat label="Revenue" value={formatHuf(recent.grandTotalHuf)} hint="paid + confirmed" />
          </>
        ) : null}
      </StatRow>

      {recent ? (
        <Card
          title="Latest bookings"
          actions={
            <Link className="tbook-btn tbook-btn-secondary tbook-btn-sm" href="/admin/bookings">
              View all
            </Link>
          }
        >
          {recent.bookings.length === 0 ? (
            <EmptyState
              title="No bookings yet"
              hint="Bookings made through the storefront or the public API will appear here."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Booked</th>
                  <th>Customer</th>
                  <th>Event</th>
                  <th className="tbook-num">Guests</th>
                  <th className="tbook-num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.bookings.map((booking) => (
                  <tr key={String(booking._id)}>
                    <td className="tbook-faint">{formatDateTime(booking.createdAt)}</td>
                    <td>
                      <Link href={`/admin/bookings/${String(booking._id)}`}>{booking.customer?.name}</Link>
                    </td>
                    <td className="tbook-wrap">{booking.eventName}</td>
                    <td className="tbook-num">{booking.guests}</td>
                    <td className="tbook-num">{formatHuf(booking.totalHuf, booking.currency)}</td>
                    <td>
                      <Badge tone={BOOKING_STATUS_TONES[booking.status] ?? "neutral"}>{booking.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : (
        <Card title="Bookings">
          <p className="tbook-muted">You don&apos;t have permission to read this organization&apos;s bookings.</p>
        </Card>
      )}
    </>
  );
}
