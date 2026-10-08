import { randomUUID } from "node:crypto";
import { ActionError } from "@tbook/actions";
import { bookingRepository, eventRepository, voucherRepository, type IVoucher } from "@tbook/db";
import type { AttendeeFieldDef, AttendeeFieldValue } from "@tbook/schemas";

/**
 * Ported from the legacy plugin's services/voucher-service.ts — lifecycle
 * only. PDF/QR rendering (legacy: buildVoucherPdf) and email delivery
 * (legacy: sendVoucherEmail) are explicitly deferred to a later pass; this
 * file produces the voucher DB rows (with real opaque tokens) and handles
 * check-in state. `issueVoucherRowsForBooking` deliberately leaves
 * `pdfFileName: null` — the follow-up pass renders the PDF, uploads it via
 * whatever replaces MediaService, and updates each row's `pdfFileName` +
 * email-sent tracking; it should NOT need to touch the row-creation logic
 * here, just add a step after it.
 */

/** Resolve display name from attendee fields or the booking's customer name. */
/** Picks the field most likely to hold a person's name out of a field schema. */
function findNameField(schema: AttendeeFieldDef[], fields: Record<string, AttendeeFieldValue>): string | null {
  const labelled = schema.find((f) => f.type === "text" && (/név|name/i.test(f.label) || /név|name/i.test(f.key)));
  if (labelled && fields[labelled.key]) return String(fields[labelled.key]).trim();

  const firstText = schema.find((f) => f.type === "text" && fields[f.key]);
  if (firstText && fields[firstText.key]) return String(fields[firstText.key]).trim();

  return null;
}

/**
 * The name printed on one entry ticket.
 *
 * For a team entry the ticket covers a roster, and the roster's own fields
 * are what identify it — the entry's top-level `fields` are usually empty
 * on such a booking (the real Hungarian Open Pairs data looks exactly like
 * this). Falling straight through to the buyer's name, as this did before,
 * printed "Klaus Lundberg" on a ticket covering five Danish players, which
 * tells the door staff nothing about who may walk in. So a roster is named
 * after its players.
 *
 * `teamMemberFieldSchema` is optional purely for backward compatibility
 * with existing callers; without it the roster can't be read and the old
 * buyer-name behaviour applies.
 */
export function resolveAttendeeDisplayName(
  attendeeIndex: number,
  attendees: Array<{ fields: Record<string, AttendeeFieldValue>; members?: Array<{ fields: Record<string, AttendeeFieldValue> }> }>,
  attendeeFieldSchema: AttendeeFieldDef[],
  customerName: string,
  guests: number,
  teamMemberFieldSchema: AttendeeFieldDef[] = [],
): string {
  const attendee = attendees[attendeeIndex];
  const fields = attendee?.fields ?? {};

  const ownName = findNameField(attendeeFieldSchema, fields);
  if (ownName) return ownName;

  const members = attendee?.members ?? [];
  if (members.length > 0 && teamMemberFieldSchema.length > 0) {
    const names = members.map((member) => findNameField(teamMemberFieldSchema, member.fields ?? {})).filter((name): name is string => Boolean(name));

    if (names.length === 1) return names[0]!;
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    // Beyond a pair the full list would overflow the ticket layout, so the
    // first player plus a count keeps it both short and unambiguous.
    if (names.length > 2) return `${names[0]} +${names.length - 1}`;
  }

  if (guests === 1) return customerName.trim();
  return `${customerName.trim()} (${attendeeIndex + 1}. vendég)`;
}

/** Extracts an opaque voucher token from raw scanner input — a bare token, a validation URL, or a `?token=` query param. */
export function parseVoucherTokenFromScan(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const fromPath = url.pathname.split("/").filter(Boolean).pop();
    if (fromPath && /^[0-9a-f-]{36}$/i.test(fromPath)) return fromPath;
    const fromQuery = url.searchParams.get("token");
    if (fromQuery) return fromQuery.trim();
  } catch {
    // Not a URL — treat the raw input as the token itself.
  }
  return trimmed;
}

/**
 * Creates one voucher row per guest for a paid/confirmed booking.
 * Idempotent — returns the existing rows unchanged if already issued.
 */
export async function issueVoucherRowsForBooking(bookingId: string): Promise<IVoucher[]> {
  const existing = await voucherRepository.findByBookingId(bookingId);
  if (existing.length > 0) return existing;

  const booking = await bookingRepository.findById(bookingId);
  if (!booking) throw ActionError.notFound("Booking not found.");
  if (booking.status !== "paid" && booking.status !== "confirmed") {
    throw ActionError.validation("Vouchers can only be issued for a paid booking.");
  }

  const event = await eventRepository.findById(String(booking.eventId));
  if (!event || !event.vouchersEnabled) return [];

  const eventSnapshot = {
    name: event.name,
    startDate: event.startDate,
    endDate: event.endDate,
    startTime: event.startTime ?? null,
    endTime: event.endTime ?? null,
    locationAddress: event.location?.address ?? "",
  };

  const schema = booking.attendeeFieldSchema ?? [];
  const rows = Array.from({ length: booking.guests }, (_, attendeeIndex) => ({
    organizationId: booking.organizationId ?? null,
    eventId: booking.eventId,
    bookingId: booking._id,
    attendeeIndex,
    token: randomUUID(),
    status: "active" as const,
    displayName: resolveAttendeeDisplayName(
      attendeeIndex,
      booking.attendees ?? [],
      schema,
      booking.customer.name,
      booking.guests,
      booking.teamMemberFieldSchema ?? [],
    ),
    attendeeFields: booking.attendees?.[attendeeIndex]?.fields ?? {},
    eventSnapshot,
    pdfFileName: null,
  }));

  return voucherRepository.createMany(rows);
}

/** On booking cancellation, void every non-void voucher for that booking. */
export async function voidVouchersForBooking(bookingId: string): Promise<void> {
  await voucherRepository.voidAllForBooking(bookingId);
}

export type VoucherScanResult = "valid" | "duplicate" | "invalid" | "wrong_event";

export interface VoucherScanResponse {
  result: VoucherScanResult;
  voucher?: IVoucher;
  message: string;
}

export interface ScanVoucherOptions {
  /** Scope the scan to one event — mismatches report "wrong_event" instead of silently checking in. */
  eventId?: string;
  organizationId?: string;
  userId?: string | null;
  /** "lookup" reports voucher status without checking it in. */
  mode?: "check_in" | "lookup";
}

/**
 * Parses a raw scan, resolves the voucher, and (unless mode is "lookup")
 * atomically checks it in. The findOneAndUpdate in voucherRepository.checkIn
 * is the CAS guard against a double-scan race — its filter only matches
 * status:"active", so a second concurrent scan of the same voucher always
 * loses the race and falls into the "duplicate" branch below.
 */
export async function scanVoucher(rawToken: string, opts: ScanVoucherOptions = {}): Promise<VoucherScanResponse> {
  const token = parseVoucherTokenFromScan(rawToken);
  if (!token) return { result: "invalid", message: "Invalid QR code." };

  const voucher = await voucherRepository.findByToken(token);
  if (!voucher) return { result: "invalid", message: "Voucher not found." };

  if (opts.organizationId && voucher.organizationId && String(voucher.organizationId) !== opts.organizationId) {
    return { result: "invalid", message: "Voucher not found." };
  }
  if (opts.eventId && String(voucher.eventId) !== opts.eventId) {
    return { result: "wrong_event", message: "This voucher is for a different event.", voucher };
  }
  if (voucher.status === "void") {
    return { result: "invalid", message: "This voucher is void (booking cancelled).", voucher };
  }
  if (voucher.status === "checked_in") {
    return { result: "duplicate", message: "Already checked in.", voucher };
  }
  if (opts.mode === "lookup") {
    return { result: "valid", message: "Valid voucher (not yet checked in).", voucher };
  }

  const updated = await voucherRepository.checkIn(String(voucher._id), opts.userId ?? null);
  if (!updated) {
    // Lost the CAS race to a concurrent scan between our read and the check-in attempt.
    const latest = await voucherRepository.findById(String(voucher._id));
    return { result: "duplicate", message: "Already checked in.", voucher: latest ?? voucher };
  }

  return { result: "valid", message: "Checked in.", voucher: updated };
}
