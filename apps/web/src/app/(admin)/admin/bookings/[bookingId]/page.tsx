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
import { AttachInvoicePanel, EditBookingPanel, MarkPaidPanel } from "./manage-panels";

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
  const canManage = permissions.has("booking:manage");
  const isTeamBooking = (booking.teamMemberFieldSchema?.length ?? 0) > 0;
  const awaitingPayment = booking.status === "pending" || booking.status === "checkout_started";
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

      {canManage && awaitingPayment ? <MarkPaidPanel bookingId={bookingId} /> : null}

      {canManage ? (
        <EditBookingPanel
          bookingId={bookingId}
          guests={booking.guests}
          customer={{
            name: booking.customer?.name ?? "",
            email: booking.customer?.email ?? "",
            phone: booking.customer?.phone ?? "",
          }}
          adminNote={booking.adminNote ?? ""}
          attendees={JSON.parse(JSON.stringify(booking.attendees ?? []))}
          attendeeFields={JSON.parse(JSON.stringify(booking.attendeeFieldSchema ?? []))}
          teamMemberFields={JSON.parse(JSON.stringify(booking.teamMemberFieldSchema ?? []))}
        />
      ) : null}

      {canManage ? (
        <AttachInvoicePanel
          bookingId={bookingId}
          invoiceNumber={booking.invoiceNumber ?? booking.invoiceId ?? null}
          invoiceSource={booking.invoiceSource ?? "szamlazz"}
        />
      ) : null}

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
              {
                label: "Payment",
                value: booking.offlinePayment
                  ? `${booking.paymentMethod ?? "transfer"}${booking.offlinePayment.reference ? ` · ${booking.offlinePayment.reference}` : ""}`
                  : (booking.paymentMethod ?? "stripe"),
              },
              {
                label: "Created by",
                value:
                  booking.source === "admin" ? (
                    <Badge tone="info">admin console</Badge>
                  ) : (
                    <Badge tone="neutral">storefront</Badge>
                  ),
              },
              { label: "Expires at", value: formatDateTime(booking.expiresAt) },
              { label: "Booking id", value: <code className="tbook-faint">{bookingId}</code> },
              ...(booking.adminNote
                ? [{ label: "Admin note", value: <span style={{ whiteSpace: "pre-wrap" }}>{booking.adminNote}</span> }]
                : []),
              ...(booking.offlinePayment?.note
                ? [{ label: "Payment note", value: booking.offlinePayment.note }]
                : []),
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

      <Card title={isTeamBooking ? `Teams (${booking.attendees?.length ?? 0})` : `Attendees (${booking.attendees?.length ?? 0})`}>
        {!booking.attendees || booking.attendees.length === 0 ? (
          <EmptyState title="No attendee details captured" hint="This event doesn't collect per-attendee fields." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>#</th>
                <th>{isTeamBooking ? "Roster" : "Details"}</th>
              </tr>
            </thead>
            <tbody>
              {booking.attendees.map((attendee, index) => {
                const own = describeFields(attendee?.fields, booking.attendeeFieldSchema ?? []);
                // A team entry keeps its players under `members`, and the
                // entry's own fields are usually empty — rendering only
                // those showed a bare "—" for every pair in the real data.
                const members = attendee?.members ?? [];
                return (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td className="tbook-wrap">
                      {own ? <div>{own}</div> : null}
                      {members.length > 0 ? (
                        <ol style={{ margin: own ? "6px 0 0" : 0, paddingLeft: 20 }}>
                          {members.map((member, memberIndex) => (
                            <li key={memberIndex}>
                              {describeFields(member?.fields, booking.teamMemberFieldSchema ?? []) || "—"}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {!own && members.length === 0 ? "—" : null}
                    </td>
                  </tr>
                );
              })}
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

/**
 * Renders one attendee's or player's fields as a readable line, resolving
 * both sides against the schema: the field's label instead of its key
 * ("Teljes név" not "teljes_nev"), and a select's choice label instead of
 * its stored value ("Female" not "option_2"). The raw forms are what the
 * database holds and are meaningless to an org manager reading the screen.
 *
 * Anything no longer in the schema falls back to the raw key/value, so
 * historical data still shows rather than disappearing.
 */
function describeFields(
  fields: Record<string, unknown> | undefined,
  schema: Array<{ key: string; label: string; choices?: Array<{ value: string; label: string }> }>,
): string {
  const entries = Object.entries(fields ?? {}).filter(([key]) => key !== "_id");
  if (entries.length === 0) return "";

  const byKey = new Map(schema.map((field) => [field.key, field]));

  return entries
    .map(([key, value]) => {
      const field = byKey.get(key);
      const label = field?.label ?? key;
      const choice = field?.choices?.find((option) => option.value === String(value));
      return `${label}: ${choice?.label ?? formatFieldValue(value)}`;
    })
    .join(" · ");
}
