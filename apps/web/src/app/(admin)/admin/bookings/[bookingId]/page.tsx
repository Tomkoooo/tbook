import Link from "next/link";
import { getBookingDetailForOrg } from "@tbook/services";
import {
  BOOKING_STATUS_TONES,
  Badge,
  Card,
  DescriptionList,
  EmptyState,
  INVOICE_STATUS_TONES,
  PageHeader,
  Table,
  VOUCHER_STATUS_TONES,
} from "@tbook/ui";
import { formatDateTime, formatMoney, requireAdminPage } from "@/lib/admin-page";
import { BookingActions } from "./booking-actions";

export const dynamic = "force-dynamic";

/** Renders one quote line; the quote's own `lines` array is the authoritative breakdown. */
interface QuoteLine {
  key?: string;
  label?: string;
  amountHuf?: number;
}

export default async function BookingDetailPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { organizationId, permissions } = await requireAdminPage("booking:read");
  const { bookingId } = await params;

  const { booking, vouchers } = await getBookingDetailForOrg(organizationId, bookingId);
  const currency = booking.currency ?? "HUF";
  const quoteLines = ((booking.quote?.lines ?? []) as QuoteLine[]).filter((line) => line.amountHuf != null);

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/admin/bookings">← Bookings</Link>}
        title={booking.customer?.name ?? "Booking"}
        description={`${booking.eventName} · booked ${formatDateTime(booking.createdAt)}`}
        actions={
          <>
            <Badge tone={BOOKING_STATUS_TONES[booking.status] ?? "neutral"}>{booking.status}</Badge>
            <Badge tone={INVOICE_STATUS_TONES[booking.invoiceStatus] ?? "neutral"}>
              invoice: {booking.invoiceStatus}
            </Badge>
          </>
        }
      />

      <BookingActions
        bookingId={bookingId}
        status={booking.status}
        customerEmail={booking.customer?.email ?? ""}
        voucherCount={vouchers.length}
        canManageBooking={permissions.has("booking:manage")}
        canManageVouchers={permissions.has("voucher:manage")}
      />

      <div className="tbook-grid-2">
        <Card title="Customer">
          <DescriptionList
            items={[
              { label: "Name", value: booking.customer?.name ?? "—" },
              {
                label: "Email",
                value: booking.customer?.email ? (
                  <a href={`mailto:${booking.customer.email}`}>{booking.customer.email}</a>
                ) : (
                  "—"
                ),
              },
              {
                label: "Phone",
                value: booking.customer?.phone ? <a href={`tel:${booking.customer.phone}`}>{booking.customer.phone}</a> : "—",
              },
              {
                label: "Note",
                value: booking.customer?.note ? (
                  <span style={{ whiteSpace: "pre-wrap" }}>{booking.customer.note}</span>
                ) : (
                  "—"
                ),
              },
            ]}
          />
        </Card>

        <Card title="Booking">
          <DescriptionList
            items={[
              { label: "Event", value: booking.eventName },
              { label: "Group", value: booking.groupName || "—" },
              { label: "Guests", value: booking.guests },
              { label: "Accommodation", value: booking.hotelName || "—" },
              { label: "Nights", value: booking.nights || "—" },
              { label: "Paid at", value: formatDateTime(booking.paidAt) },
              { label: "Expires at", value: formatDateTime(booking.expiresAt) },
              { label: "Booking id", value: <code className="tbook-faint">{bookingId}</code> },
            ]}
          />
        </Card>
      </div>

      <Card title="Price breakdown">
        {quoteLines.length === 0 ? (
          <DescriptionList items={[{ label: "Total", value: formatMoney(booking.totalHuf, currency) }]} />
        ) : (
          <DescriptionList
            items={[
              ...quoteLines.map((line) => ({
                label: line.label ?? line.key ?? "—",
                value: formatMoney(line.amountHuf ?? 0, currency),
              })),
              { label: <strong>Total</strong>, value: <strong>{formatMoney(booking.totalHuf, currency)}</strong> },
            ]}
          />
        )}
      </Card>

      {booking.billing ? (
        <Card title="Billing details">
          <DescriptionList
            items={[
              { label: "Type", value: booking.billing.billingType },
              { label: "Name", value: booking.billing.name },
              {
                label: "Address",
                value: `${booking.billing.zip} ${booking.billing.city}, ${booking.billing.street} (${booking.billing.countryCode})`,
              },
              { label: "Tax number", value: booking.billing.taxNumber || "—" },
              { label: "Invoice id", value: booking.invoiceId || "—" },
              ...(booking.invoiceError ? [{ label: "Invoice error", value: booking.invoiceError }] : []),
            ]}
          />
        </Card>
      ) : null}

      <Card title={`Attendees (${booking.attendees?.length ?? 0})`}>
        {!booking.attendees || booking.attendees.length === 0 ? (
          <EmptyState title="No attendee details captured" hint="This event doesn't collect per-attendee fields." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>#</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {booking.attendees.map((attendee, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td className="tbook-wrap">
                    {Object.entries((attendee as { fields?: Record<string, unknown> })?.fields ?? attendee ?? {})
                      .filter(([key]) => key !== "_id")
                      .map(([key, value]) => `${key}: ${formatFieldValue(value)}`)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {permissions.has("voucher:read") ? (
        <Card title={`Entries (${vouchers.length})`}>
          {vouchers.length === 0 ? (
            <EmptyState
              title="No entries issued"
              hint="Entries are issued automatically once the booking is paid."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Attendee</th>
                  <th>Status</th>
                  <th>Checked in</th>
                  <th>Emailed</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((voucher) => (
                  <tr key={String(voucher._id)}>
                    <td>{voucher.attendeeIndex + 1}</td>
                    <td>{voucher.displayName}</td>
                    <td>
                      <Badge tone={VOUCHER_STATUS_TONES[voucher.status] ?? "neutral"}>{voucher.status}</Badge>
                    </td>
                    <td className="tbook-faint">{formatDateTime(voucher.checkedInAt)}</td>
                    <td className="tbook-faint">
                      {voucher.emailedAt ? `${formatDateTime(voucher.emailedAt)} → ${voucher.lastSentToEmail ?? ""}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}

      {booking.tdartsSync && booking.tdartsSync.length > 0 ? (
        <Card title="tDarts sync">
          <Table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Tournament</th>
                <th>Status</th>
                <th>Synced</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {booking.tdartsSync.map((entry, index) => (
                <tr key={index}>
                  <td>{entry.participantKey}</td>
                  <td>{entry.tournamentCode}</td>
                  <td>
                    <Badge tone={entry.status === "synced" ? "success" : entry.status === "failed" ? "danger" : "warning"}>
                      {entry.status}
                    </Badge>
                  </td>
                  <td className="tbook-faint">{formatDateTime(entry.syncedAt)}</td>
                  <td className="tbook-wrap tbook-faint">{entry.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}

function formatFieldValue(value: unknown): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
