import { getBookingDetailForOrg } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DescriptionList } from "@/components/description-list";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { BOOKING_STATUS_TONES, INVOICE_STATUS_TONES, VOUCHER_STATUS_TONES, toneFor } from "@/lib/status-tones";
import { formatDateTime, formatMoney, requireAdminPage } from "@/lib/admin-page";
import { BookingActions } from "./booking-actions";
import { ReceiptPanel } from "./receipt-panel";
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
  const walkIn = booking.delivery === "receipt";
  const quoteLines = ((booking.quote?.lines ?? []) as QuoteLine[]).filter((line) => line.amountHuf != null);

  return (
    <>
      <PageTitle
        back={{ href: "/admin/bookings", label: "Bookings" }}
        title={booking.customer?.name ?? "Booking"}
        description={`${booking.eventName} · booked ${formatDateTime(booking.createdAt)}`}
        actions={
          <div className="flex items-center gap-1">
            <Badge variant={toneFor(BOOKING_STATUS_TONES, booking.status)}>{booking.status}</Badge>
            <Badge variant={toneFor(INVOICE_STATUS_TONES, booking.invoiceStatus)}>invoice: {booking.invoiceStatus}</Badge>
          </div>
        }
      />

      <BookingActions
        bookingId={bookingId}
        status={booking.status}
        customerEmail={walkIn ? "" : (booking.customer?.email ?? "")}
        voucherCount={walkIn ? 0 : vouchers.length}
        canManageBooking={permissions.has("booking:manage")}
        canManageVouchers={permissions.has("voucher:manage")}
      />

      {walkIn ? (
        <ReceiptPanel
          bookingId={bookingId}
          status={booking.receipt?.status ?? "none"}
          number={booking.receipt?.number ?? null}
          error={booking.receipt?.error ?? null}
          hasPdf={Boolean(booking.receipt?.pdfFileName)}
        />
      ) : null}

      {canManage && awaitingPayment ? <MarkPaidPanel bookingId={bookingId} /> : null}

      {canManage && !walkIn ? (
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

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Customer">
          <DescriptionList
            items={[
              { label: "Name", value: booking.customer?.name ?? "—" },
              ...(walkIn ? [{ label: "Contact", value: <span className="text-muted-foreground">Walk-in — no contact details taken</span> }] : []),
              {
                label: "Email",
                value: walkIn ? "—" : booking.customer?.email ? (
                  <a className="text-primary hover:underline" href={`mailto:${booking.customer.email}`}>{booking.customer.email}</a>
                ) : (
                  "—"
                ),
              },
              {
                label: "Phone",
                value: walkIn ? "—" : booking.customer?.phone ? <a className="text-primary hover:underline" href={`tel:${booking.customer.phone}`}>{booking.customer.phone}</a> : "—",
              },
              {
                label: "Note",
                value: booking.customer?.note ? (
                  <span className="whitespace-pre-wrap">{booking.customer.note}</span>
                ) : (
                  "—"
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="Booking">
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
                  booking.source === "pos" ? (
                    <Badge variant="info">{walkIn ? "point of sale · walk-in" : "point of sale"}</Badge>
                  ) : booking.source === "admin" ? (
                    <Badge variant="info">admin console</Badge>
                  ) : (
                    <Badge variant="neutral">storefront</Badge>
                  ),
              },
              { label: "Expires at", value: formatDateTime(booking.expiresAt) },
              { label: "Booking id", value: <code className="text-muted-foreground font-mono text-xs">{bookingId}</code> },
              ...(booking.adminNote
                ? [{ label: "Admin note", value: <span className="whitespace-pre-wrap">{booking.adminNote}</span> }]
                : []),
              ...(booking.offlinePayment?.note
                ? [{ label: "Payment note", value: booking.offlinePayment.note }]
                : []),
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard title="Price breakdown">
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
      </SectionCard>

      {booking.billing ? (
        <SectionCard title="Billing details">
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
        </SectionCard>
      ) : null}

      <SectionCard flush title={isTeamBooking ? `Teams (${booking.attendees?.length ?? 0})` : `Attendees (${booking.attendees?.length ?? 0})`}>
        {!booking.attendees || booking.attendees.length === 0 ? (
          <EmptyState title="No attendee details captured" hint="This event doesn't collect per-attendee fields." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{isTeamBooking ? "Roster" : "Details"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {booking.attendees.map((attendee, index) => {
                const own = describeFields(attendee?.fields, booking.attendeeFieldSchema ?? []);
                // A team entry keeps its players under `members`, and the
                // entry's own fields are usually empty — rendering only
                // those showed a bare "—" for every pair in the real data.
                const members = attendee?.members ?? [];
                return (
                  <TableRow key={index}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell className="whitespace-normal">
                      {own ? <div>{own}</div> : null}
                      {members.length > 0 ? (
                        <ol className={`list-decimal pl-5 ${own ? "mt-1.5" : ""}`}>
                          {members.map((member, memberIndex) => (
                            <li key={memberIndex}>
                              {describeFields(member?.fields, booking.teamMemberFieldSchema ?? []) || "—"}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {!own && members.length === 0 ? "—" : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {permissions.has("voucher:read") ? (
        <SectionCard flush title={`Entries (${vouchers.length})`}>
          {vouchers.length === 0 ? (
            <EmptyState
              title="No entries issued"
              hint="Entries are issued automatically once the booking is paid."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Attendee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Checked in</TableHead>
                  <TableHead>Emailed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers.map((voucher) => (
                  <TableRow key={String(voucher._id)}>
                    <TableCell>{voucher.attendeeIndex + 1}</TableCell>
                    <TableCell>{voucher.displayName}</TableCell>
                    <TableCell>
                      <Badge variant={toneFor(VOUCHER_STATUS_TONES, voucher.status)}>{voucher.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(voucher.checkedInAt)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {voucher.emailedAt ? `${formatDateTime(voucher.emailedAt)} → ${voucher.lastSentToEmail ?? ""}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      ) : null}

      {booking.tdartsSync && booking.tdartsSync.length > 0 ? (
        <SectionCard flush title="tDarts sync">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Participant</TableHead>
                <TableHead>Tournament</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Synced</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {booking.tdartsSync.map((entry, index) => (
                <TableRow key={index}>
                  <TableCell>{entry.participantKey}</TableCell>
                  <TableCell>{entry.tournamentCode}</TableCell>
                  <TableCell>
                    <Badge variant={entry.status === "synced" ? "success" : entry.status === "failed" ? "danger" : "warning"}>
                      {entry.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(entry.syncedAt)}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-normal">{entry.error ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
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
