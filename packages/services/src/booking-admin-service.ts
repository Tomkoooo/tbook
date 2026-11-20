import {
  bookingRepository,
  eventGroupRepository,
  eventRepository,
  hotelRepository,
  VoucherModel,
  voucherRepository,
  type BookingListFilter,
  type BookingScope,
  type BookingSortKey,
  type IBooking,
  type IVoucher,
} from "@tbook/db";
import { ActionError } from "@tbook/actions";
import type { BookingStatus, InvoiceStatus } from "@tbook/schemas";
import { cancelBooking, confirmBooking } from "./booking-service";
import { voidVouchersForBooking } from "./voucher-service";
import { sendBookingEmail } from "./booking-email";
import { bookingWebhookData, dispatchWebhookEvent } from "./webhook-service";

/**
 * Read models + write orchestration behind the admin booking console. The
 * repositories do the query building, @tbook/domain does the math, and this
 * module only composes them — permission enforcement stays at the request
 * layer (apps/web's requireOrgPermission), exactly like org-service.
 */

/**
 * Resolves the org's query scope. Every admin booking read goes through
 * this because `organizationId` alone under-selects: real production
 * documents exist with no `organizationId` field (see
 * scripts/migration-fixtures), so the scope has to carry the org's group
 * ids for the union in buildBookingQuery. One extra small query per
 * request buys correctness on legacy data.
 */
export async function resolveBookingScope(organizationId: string): Promise<BookingScope> {
  const groups = await eventGroupRepository.findByOrganizationId(organizationId);
  return { organizationId, groupIds: groups.map((group) => String(group._id)) };
}

export interface AdminBookingListQuery extends BookingListFilter {
  /** Only bookings with a guest carrying this tag (e.g. "Díjazott"). */
  tag?: string;
  /** Only bookings with a guest who is checked in ("in") or still expected ("not_in") — combined with `tag`, the same guest. */
  checkIn?: "in" | "not_in";
  page?: number;
  pageSize?: number;
  sortBy?: BookingSortKey;
  sortDir?: "asc" | "desc";
}

export interface AdminBookingStatusTotal {
  status: BookingStatus;
  currency: string;
  count: number;
  totalHuf: number;
  guests: number;
}

export interface AdminBookingListResult {
  bookings: IBooking[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Totals for the *filtered* set, so the summary row matches what's shown. */
  statusTotals: AdminBookingStatusTotal[];
  /**
   * Collected revenue, one entry per currency.
   *
   * Not a single number: `totalHuf` is a legacy misnomer holding the amount
   * in the booking's own currency, and an org can hold bookings in more
   * than one, so a single scalar would be an invented sum. Callers render
   * each entry separately.
   */
  revenueByCurrency: Array<{ currency: string; totalHuf: number }>;
  /** Guests across paid + confirmed bookings — currency-independent, so safe to sum. */
  paidGuests: number;
}

const MAX_PAGE_SIZE = 200;

export async function listBookingsForOrg(organizationId: string, query: AdminBookingListQuery = {}): Promise<AdminBookingListResult> {
  const scope = await resolveBookingScope(organizationId);
  const { page: rawPage, pageSize: rawPageSize, sortBy, sortDir, tag, checkIn, ...baseFilter } = query;
  let filter: BookingListFilter = baseFilter;
  if (tag || checkIn) {
    const voucherQuery: Record<string, unknown> = { status: checkIn === "in" ? "checked_in" : checkIn === "not_in" ? "active" : { $ne: "void" } };
    if (tag) voucherQuery.tags = tag;
    if (baseFilter.eventId) voucherQuery.eventId = baseFilter.eventId;
    const ids = (await VoucherModel.distinct("bookingId", voucherQuery).exec()).map(String);
    filter = { ...baseFilter, bookingIds: ids };
  }

  const pageSize = Math.min(Math.max(rawPageSize ?? 25, 1), MAX_PAGE_SIZE);
  const page = Math.max(rawPage ?? 1, 1);

  const [bookings, total, statusTotals] = await Promise.all([
    bookingRepository.listInScope(scope, filter, { limit: pageSize, skip: (page - 1) * pageSize, sortBy, sortDir }),
    bookingRepository.countInScope(scope, filter),
    bookingRepository.aggregateStatusTotalsInScope(scope, filter),
  ]);

  // Revenue counts only money actually collected — a pending or expired
  // booking's total is not income, and summing every row would badly
  // overstate it on an event with heavy checkout abandonment.
  const collected = statusTotals.filter((row) => row.status === "paid" || row.status === "confirmed");

  const byCurrency = new Map<string, number>();
  for (const row of collected) {
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.totalHuf);
  }

  return {
    bookings,
    total,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
    statusTotals,
    revenueByCurrency: [...byCurrency.entries()]
      .map(([currency, totalHuf]) => ({ currency, totalHuf }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    paidGuests: collected.reduce((sum, row) => sum + row.guests, 0),
  };
}

export interface BookingGuestSummary {
  guests: number;
  checkedIn: number;
  tags: string[];
}

/** Per booking: how many guests hold a ticket, how many are checked in, and their tags — for the bookings list. */
export async function summarizeBookingGuests(bookingIds: string[]): Promise<Map<string, BookingGuestSummary>> {
  const out = new Map<string, BookingGuestSummary>();
  if (bookingIds.length === 0) return out;
  const vouchers = await VoucherModel.find({ bookingId: { $in: bookingIds }, status: { $ne: "void" } }, { bookingId: 1, status: 1, tags: 1 }).lean().exec();
  for (const voucher of vouchers) {
    const id = String(voucher.bookingId);
    const entry = out.get(id) ?? { guests: 0, checkedIn: 0, tags: [] };
    entry.guests += 1;
    if (voucher.status === "checked_in") entry.checkedIn += 1;
    for (const tag of voucher.tags ?? []) if (!entry.tags.includes(tag)) entry.tags.push(tag);
    out.set(id, entry);
  }
  return out;
}

export interface AdminBookingDetail {
  booking: IBooking;
  vouchers: IVoucher[];
}

/** Org-scoped detail read. Throws 404 (not 403) for another org's booking, so the id space isn't probeable. */
export async function getBookingDetailForOrg(organizationId: string, bookingId: string): Promise<AdminBookingDetail> {
  const scope = await resolveBookingScope(organizationId);
  const booking = await bookingRepository.findByIdInScope(bookingId, scope);
  if (!booking) throw ActionError.notFound("Booking not found");

  const vouchers = await voucherRepository.findByBookingId(String(booking._id));
  return { booking, vouchers };
}

/**
 * Admin cancellation: releases event capacity (booking-service) *and*
 * voids the booking's vouchers so an already-issued QR code stops being
 * admittable at the door. Composing the two here is deliberate — it keeps
 * booking-service independent of voucher-service.
 */
export async function cancelBookingAsAdmin(
  organizationId: string,
  bookingId: string,
  opts: { reason?: string } = {},
): Promise<IBooking> {
  const scope = await resolveBookingScope(organizationId);
  const existing = await bookingRepository.findByIdInScope(bookingId, scope);
  if (!existing) throw ActionError.notFound("Booking not found");

  const updated = await cancelBooking(bookingId, opts);
  if (!updated) throw ActionError.notFound("Booking not found");

  await voidVouchersForBooking(bookingId);

  // A cancelled team must not keep its place on the tDarts tournament. Never
  // throws; a refusal (e.g. the draw is already made) is recorded on
  // booking.tdartsSync for the org manager to act on.
  let result = updated;
  if ((updated.tdartsSync ?? []).length > 0) {
    const { withdrawBookingFromTDarts } = await import("./tdarts-sync-service");
    const outcome = await withdrawBookingFromTDarts(bookingId);
    if (outcome.withdrawn + outcome.failed > 0) {
      result = (await bookingRepository.findById(bookingId)) ?? updated;
    }
  }

  // Best-effort: dispatchWebhookEvent never throws, so a broken customer
  // integration cannot make a cancellation fail. The acting org is used
  // rather than the booking's own field, which legacy rows may not have.
  if (!result.isTest) await dispatchWebhookEvent(organizationId, "booking.cancelled", bookingWebhookData(result));

  return result;
}

export async function confirmBookingAsAdmin(organizationId: string, bookingId: string): Promise<IBooking> {
  const scope = await resolveBookingScope(organizationId);
  const existing = await bookingRepository.findByIdInScope(bookingId, scope);
  if (!existing) throw ActionError.notFound("Booking not found");

  const updated = await confirmBooking(bookingId);
  if (!updated) throw ActionError.notFound("Booking not found");
  return updated;
}

/**
 * Re-sends the voucher PDF email for a booking whose guest lost it — the
 * single most common support request this console exists to handle.
 * Restricted to bookings that actually have vouchers (i.e. paid ones);
 * anything else would send an empty PDF.
 */
export async function resendVoucherEmailAsAdmin(
  organizationId: string,
  bookingId: string,
  opts: { toEmail?: string } = {},
): Promise<{ sentTo: string }> {
  const scope = await resolveBookingScope(organizationId);
  const booking = await bookingRepository.findByIdInScope(bookingId, scope);
  if (!booking) throw ActionError.notFound("Booking not found");

  const vouchers = await voucherRepository.findByBookingId(bookingId);
  if (vouchers.length === 0) {
    throw ActionError.validation("This booking has no entries to send yet — only paid bookings have vouchers.");
  }

  const toEmail = opts.toEmail?.trim() || booking.customer?.email;
  if (!toEmail) throw ActionError.validation("This booking has no email address to send to.");

  // Re-sends the whole booking email (tickets + invoice if issued). It
  // re-renders the ticket PDF, so a layout edited since is picked up.
  await sendBookingEmail(bookingId, { toEmail });
  return { sentTo: toEmail };
}

/**
 * Filter dropdown options for the console. Returns every group/event in the
 * org (not just active ones) — an admin specifically needs to look up
 * bookings for archived events.
 */
export async function listBookingFilterOptions(organizationId: string): Promise<{
  groups: Array<{ id: string; name: string }>;
  events: Array<{ id: string; name: string; groupId: string | null }>;
  hotels: Array<{ id: string; name: string }>;
  tags: string[];
  /** Every guest answer asked on any of the org's events — selectable as a bookings-table column. */
  guestFields: Array<{ key: string; label: string; identifier: boolean }>;
}> {
  const groups = await eventGroupRepository.findByOrganizationId(organizationId);
  const groupIds = groups.map((group) => String(group._id));

  const eventsPerGroup = await Promise.all(groupIds.map((groupId) => eventRepository.findByGroupId(groupId)));
  const hotelsPerGroup = await Promise.all(groupIds.map((groupId) => hotelRepository.findByGroupId(groupId)));

  const guestFields = new Map<string, { key: string; label: string; identifier: boolean }>();
  for (const event of eventsPerGroup.flat()) {
    for (const field of event.attendeeFieldSchema ?? []) {
      const known = guestFields.get(field.key);
      guestFields.set(field.key, { key: field.key, label: known?.label || field.label || field.key, identifier: Boolean(known?.identifier || field.identifier || field.unique) });
    }
  }

  return {
    guestFields: [...guestFields.values()],
    groups: groups.map((group) => ({ id: String(group._id), name: group.name })),
    events: eventsPerGroup.flat().map((event) => ({
      id: String(event._id),
      name: event.name,
      groupId: event.groupId ? String(event.groupId) : null,
    })),
    hotels: hotelsPerGroup.flat().map((hotel) => ({ id: String(hotel._id), name: hotel.name })),
    tags: ((await VoucherModel.distinct("tags", { eventId: { $in: eventsPerGroup.flat().map((event) => String(event._id)) } }).exec()) as string[])
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "hu")),
  };
}

/** CSV-escapes one field: quote-wrap and double any embedded quote. */
function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const EXPORT_COLUMNS = [
  "bookingId",
  "createdAt",
  "status",
  "eventName",
  "groupName",
  "customerName",
  "customerEmail",
  "customerPhone",
  "guests",
  "nights",
  "hotelName",
  "totalHuf",
  "currency",
  "paidAt",
  "invoiceStatus",
  "invoiceId",
] as const;

function exportRow(booking: IBooking): string {
  return [
    String(booking._id),
    booking.createdAt,
    booking.status,
    booking.eventName,
    booking.groupName,
    booking.customer?.name,
    booking.customer?.email,
    booking.customer?.phone,
    booking.guests,
    booking.nights,
    booking.hotelName,
    booking.totalHuf,
    booking.currency,
    booking.paidAt,
    booking.invoiceStatus,
    booking.invoiceId,
  ]
    .map(csvCell)
    .join(",");
}

/**
 * Streams a filtered export as CSV rows. An async generator (rather than a
 * built string) so a large org's full history is never held in memory at
 * once — the route pipes it straight into the HTTP response body.
 *
 * Starts with a UTF-8 BOM: without it Excel on Windows mis-decodes the
 * Hungarian accented names that make up most of this data.
 */
export async function* streamBookingExportCsv(organizationId: string, filter: BookingListFilter = {}): AsyncGenerator<string> {
  const scope = await resolveBookingScope(organizationId);
  yield `\uFEFF${EXPORT_COLUMNS.join(",")}\n`;

  const cursor = bookingRepository.cursorInScope(scope, filter);
  try {
    for await (const booking of cursor) {
      yield `${exportRow(booking as IBooking)}\n`;
    }
  } finally {
    await cursor.close();
  }
}

/** Parses the status query params an admin table sends, ignoring unknown values. */
export function parseStatusFilter(raw: string | null | undefined, allowed: readonly string[]): string[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => allowed.includes(value));
  return values.length > 0 ? values : undefined;
}

export type { BookingStatus, InvoiceStatus };
