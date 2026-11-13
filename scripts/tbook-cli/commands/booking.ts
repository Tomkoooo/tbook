import type { IVoucher } from "@tbook/db";
import { testData } from "@tbook/modules";
import { getBookingDetailForOrg, listBookingsForOrg, resendVoucherEmailAsAdmin } from "@tbook/services";
import type { BookingStatus } from "@tbook/schemas";
import { parseArgs, requireFlag, type Flags } from "../lib/args";
import { checkApplyGate, resolveOperator, writeRestorePoint } from "../lib/change";
import { connectDb, resolveOrganization } from "../lib/env";
import { CliError } from "../lib/errors";
import { fmtValue, printKeyValues, table } from "../lib/format";
import { confirmPhrase } from "../lib/interact";

/**
 * Booking lookup + voucher-email resend, routed through booking-admin-
 * service. Reads only list/show; the one write (resend-voucher) sends a
 * real email through the org's own SMTP/mailer, so there is no way to
 * "undo" it — the audit entry below is a record, not a restore point.
 */

async function bookingList(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));

  const statusRaw = flags.get("status");
  const status = statusRaw ? (statusRaw.split(",").map((s) => s.trim()) as BookingStatus[]) : undefined;

  const result = await listBookingsForOrg(org.id, {
    status,
    eventId: flags.get("event"),
    groupId: flags.get("group"),
    search: flags.get("q"),
    page: Number(flags.get("page") ?? 1),
    pageSize: Number(flags.get("limit") ?? 25),
  });

  console.log(`Organization: ${org.name} (${org.slug}) — ${result.total} booking(s), page ${result.page}/${result.pageCount}`);
  console.log(
    table(
      result.bookings.map((b) => ({
        id: String(b._id),
        status: b.status,
        event: b.eventName,
        customer: b.customer?.name ?? "",
        email: b.customer?.email ?? "",
        guests: String(b.guests),
        total: `${b.totalHuf} ${b.currency}`,
        test: b.isTest ? "TESZT" : "",
        createdAt: b.createdAt.toISOString().slice(0, 10),
      })),
      ["id", "status", "event", "customer", "email", "guests", "total", "test", "createdAt"],
    ),
  );
}

async function bookingShow(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const { booking, vouchers } = await getBookingDetailForOrg(org.id, requireFlag(flags, "id"));

  console.log(`Organization: ${org.name} (${org.slug})`);
  printKeyValues({
    id: String(booking._id),
    status: booking.status,
    eventName: booking.eventName,
    customerName: booking.customer?.name,
    customerEmail: booking.customer?.email,
    customerPhone: booking.customer?.phone,
    guests: booking.guests,
    totalHuf: booking.totalHuf,
    currency: booking.currency,
    paidAt: booking.paidAt,
    invoiceStatus: booking.invoiceStatus,
    createdAt: booking.createdAt,
  });
  console.log(`\nVouchers (${vouchers.length}):`);
  for (const v of vouchers as IVoucher[]) {
    console.log(`  ${v._id}  status=${v.status}  checkedInAt=${fmtValue(v.checkedInAt)}`);
  }
}

async function bookingResendVoucher(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const id = requireFlag(flags, "id");
  const { booking, vouchers } = await getBookingDetailForOrg(org.id, id);
  const to = flags.get("to")?.trim() || booking.customer?.email;
  if (!to) throw new CliError("This booking has no email address and --to was not given.");

  console.log(`Booking ${id} — ${booking.customer?.name} <${booking.customer?.email}>, ${vouchers.length} voucher(s).`);
  console.log(`Would resend the ticket/voucher email to: ${to}`);
  console.log("This sends a REAL email and cannot be undone by this CLI.");
  if (vouchers.length === 0) {
    console.log("\nThis booking has no vouchers yet (only paid bookings do) — the send will fail.");
  }

  if (checkApplyGate(flags) === "dry-run") {
    console.log("\nDRY RUN — no email sent. Re-run with --apply --prod-ack to send it.");
    return;
  }

  await confirmPhrase("RESEND", flags, "confirm-send", `About to send a real email to ${to}`);

  const before = { booking: booking.toObject(), vouchers: vouchers.map((v) => v.toObject()) };
  const result = await resendVoucherEmailAsAdmin(org.id, id, { toEmail: to });
  const after = await getBookingDetailForOrg(org.id, id);

  const operator = resolveOperator(flags);
  const dir = writeRestorePoint({
    entity: "booking",
    action: "resend-voucher",
    recordId: id,
    before,
    after: { booking: after.booking.toObject(), vouchers: after.vouchers.map((v) => v.toObject()) },
    audit: {
      timestamp: new Date().toISOString(),
      operator,
      command: process.argv.slice(2),
      entity: "booking",
      action: "resend-voucher",
      organizationId: org.id,
      recordId: id,
      changes: [{ field: "email-sent-to", before: null, after: result.sentTo }],
      reversible: false,
      note: "Sending an email cannot be undone. This record exists for the audit trail only.",
    },
  });
  console.log(`\nSent to ${result.sentTo}. Audit record: ${dir}`);
}

/**
 * `booking purge-test --org <org> --event <eventId>`: removes the event's
 * test data (v1 preview key + X-TBook-Test) — test bookings, their tickets,
 * test-namespace ID claims, bus waitlist places/boardings, email log rows,
 * test waitlist entries and test survey answers. Dry run by default (lists
 * what would go); --apply --prod-ack --confirm PURGE deletes. Sends no
 * email and changes no live counter (test records never held capacity or
 * seats). The restore point keeps every deleted document.
 */
async function bookingPurgeTest(flags: Flags): Promise<void> {
  await connectDb(flags.get("uri"));
  const org = await resolveOrganization(requireFlag(flags, "org"));
  const eventId = requireFlag(flags, "event");
  const found = await testData.findTestData(org.id, eventId);

  console.log(`Organization: ${org.name} (${org.slug}) — event ${eventId}`);
  console.log(`Test bookings (${found.bookings.length}):`);
  if (found.bookings.length > 0) {
    console.log(
      table(
        found.bookings.map((b) => ({
          id: b.id,
          regNo: b.registrationNumber ?? "",
          status: b.status,
          customer: b.customer,
          email: b.email,
          guests: String(b.guests),
          createdAt: b.createdAt.toISOString().slice(0, 16),
        })),
        ["id", "regNo", "status", "customer", "email", "guests", "createdAt"],
      ),
    );
  }
  console.log(`Test waitlist entries (${found.waitlist.length}):`);
  if (found.waitlist.length > 0) {
    console.log(
      table(
        found.waitlist.map((e) => ({ id: e.id, status: e.status, customer: e.customer, email: e.email, guests: String(e.guests), createdAt: e.createdAt.toISOString().slice(0, 16) })),
        ["id", "status", "customer", "email", "guests", "createdAt"],
      ),
    );
  }
  console.log("\nWould delete:");
  printKeyValues(found.counts as unknown as Record<string, unknown>);
  console.log("No email is sent; live capacity and bus seat counters are not touched (test records never held any).");

  const total = Object.entries(found.counts).reduce((sum, [key, n]) => (key === "attendees" ? sum : sum + n), 0);
  if (total === 0) {
    console.log("\nNothing to purge.");
    return;
  }
  if (checkApplyGate(flags) === "dry-run") {
    console.log("\nDRY RUN — nothing deleted. Re-run with --apply --prod-ack --confirm PURGE to delete.");
    return;
  }

  await confirmPhrase("PURGE", flags, "confirm", `About to delete the test data above for event ${eventId}`);
  const deleted = await testData.purgeTestData(org.id, eventId);
  const operator = resolveOperator(flags);
  const dir = writeRestorePoint({
    entity: "booking",
    action: "purge-test",
    recordId: eventId,
    before: found.documents,
    after: null,
    audit: {
      timestamp: new Date().toISOString(),
      operator,
      command: process.argv.slice(2),
      entity: "booking",
      action: "purge-test",
      organizationId: org.id,
      recordId: eventId,
      changes: Object.entries(deleted).map(([field, n]) => ({ field: `deleted.${field}`, before: found.counts[field as keyof typeof found.counts], after: n })),
      reversible: false,
      note: "Test data purge. before.json holds every deleted document (EJSON) should anything need to be re-inserted by hand.",
    },
  });
  console.log("\nDeleted:");
  printKeyValues(deleted as unknown as Record<string, unknown>);
  console.log(`Restore point: ${dir}`);
}

export async function runBookingCommand(action: string | undefined, argv: string[]): Promise<void> {
  const flags = parseArgs(argv);
  switch (action) {
    case "list":
      return bookingList(flags);
    case "show":
      return bookingShow(flags);
    case "resend-voucher":
      return bookingResendVoucher(flags);
    case "purge-test":
      return bookingPurgeTest(flags);
    default:
      throw new CliError(`Unknown "booking" action "${action ?? ""}". Try: list, show, resend-voucher, purge-test.`);
  }
}
