import type { Types } from "mongoose";
import { BookingModel, fieldClaimRepository, type IBooking } from "@tbook/db";
import { normalizeRegistrationNumber, normalizeUniqueValue } from "@tbook/domain";
import { resolveAttendeeDisplayName } from "@tbook/services";
import type { AttendeeFieldDef, AttendeeFieldValue, BookingAttendee } from "@tbook/schemas";

/** Booking statuses whose attendees hold a place (they are "registered"). */
export const ACTIVE_BOOKING_STATUSES = ["paid", "confirmed"] as const;

export interface EventAttendee {
  booking: IBooking;
  attendee: BookingAttendee;
  index: number;
  /** Stable reference: the attendee id, or "<bookingId>:<index>" for older bookings. */
  attendeeKey: string;
  displayName: string;
  registrationNumber: string | null;
  fields: Record<string, AttendeeFieldValue>;
}

export function attendeeKeyOf(booking: Pick<IBooking, "_id">, attendee: BookingAttendee | undefined, index: number): string {
  return attendee?.id ?? `${String(booking._id)}:${index}`;
}

export function toEventAttendees(booking: IBooking): EventAttendee[] {
  const attendees = (booking.attendees ?? []) as BookingAttendee[];
  const count = Math.max(booking.guests ?? 0, attendees.length);
  return Array.from({ length: count }, (_, index) => {
    const attendee = attendees[index] ?? { fields: {} };
    return {
      booking,
      attendee,
      index,
      attendeeKey: attendeeKeyOf(booking, attendee, index),
      displayName: resolveAttendeeDisplayName(
        index,
        attendees,
        (booking.attendeeFieldSchema ?? []) as AttendeeFieldDef[],
        booking.customer?.name ?? "",
        booking.guests ?? 1,
        (booking.teamMemberFieldSchema ?? []) as AttendeeFieldDef[],
      ),
      registrationNumber: attendee.registrationNumber ?? null,
      fields: (attendee.fields ?? {}) as Record<string, AttendeeFieldValue>,
    };
  });
}

/**
 * Every attendee of the event's active (live) bookings; `fieldFilter`
 * narrows by one answer at the database. Test bookings (v1 X-TBook-Test)
 * are never listed: manual sends, "not registered yet" lists and other
 * live uses must not see them.
 */
export async function listEventAttendees(eventId: string, fieldFilter?: { fieldKey: string; value: string }): Promise<EventAttendee[]> {
  const query: Record<string, unknown> = { eventId, status: { $in: ACTIVE_BOOKING_STATUSES }, isTest: { $ne: true } };
  if (fieldFilter) query[`attendees.fields.${fieldFilter.fieldKey}`] = fieldFilter.value;
  const bookings = await BookingModel.find(query).sort({ createdAt: 1 }).exec();
  const rows = bookings.flatMap(toEventAttendees);
  return fieldFilter ? rows.filter((row) => String(row.fields[fieldFilter.fieldKey] ?? "") === fieldFilter.value) : rows;
}

/** Splits a full name for a greeting. Hungarian order (family name first) unless told otherwise. */
export function givenName(fullName: string, order: "family_first" | "given_first" = "family_first"): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  // "dr." and similar prefixes are not names.
  const named = parts.filter((part) => !/^(dr|ifj|id|özv|prof)\.?$/i.test(part));
  if (named.length === 0) return parts[parts.length - 1]!;
  return order === "family_first" ? named.slice(1).join(" ") || named[0]! : named[0]!;
}

/**
 * Finds an active registration's attendee from what a guest types: their
 * registration number, or an identifying (`identifier`/`unique`) answer
 * such as an employee ID. Null when nothing matches. Live registrations
 * only; with `includeTest` (a request carrying the preview key) test
 * registrations are searched first.
 */
export async function findAttendeeByCode(
  event: { _id: Types.ObjectId | string; attendeeFieldSchema?: unknown },
  code: string,
  opts: { includeTest?: boolean } = {},
): Promise<{ booking: IBooking; attendeeIndex: number } | null> {
  const raw = code.trim();
  if (!raw) return null;
  for (const test of opts.includeTest ? [true, false] : [false]) {
    const hit = await findInPool(event, raw, test);
    if (hit) return hit;
  }
  return null;
}

async function findInPool(
  event: { _id: Types.ObjectId | string; attendeeFieldSchema?: unknown },
  raw: string,
  test: boolean,
): Promise<{ booking: IBooking; attendeeIndex: number } | null> {
  const pool = test ? { isTest: true } : { isTest: { $ne: true } };
  const asNumber = normalizeRegistrationNumber(raw);
  if (asNumber) {
    const booking = await BookingModel.findOne({ eventId: event._id, status: { $in: [...ACTIVE_BOOKING_STATUSES] }, "attendees.registrationNumber": asNumber, ...pool }).exec();
    const attendeeIndex = booking?.attendees?.findIndex((attendee) => attendee.registrationNumber === asNumber) ?? -1;
    if (booking && attendeeIndex >= 0) return { booking, attendeeIndex };
  }
  const value = normalizeUniqueValue(raw);
  const keys = ((event.attendeeFieldSchema ?? []) as AttendeeFieldDef[]).filter((field) => field.identifier || field.unique).map((field) => field.key);
  for (const key of keys) {
    const claim = await fieldClaimRepository.findForEvent(String(event._id), key, value, test);
    if (!claim) continue;
    const booking = await BookingModel.findOne({ _id: claim.bookingId, status: { $in: [...ACTIVE_BOOKING_STATUSES] }, ...pool }).exec();
    const attendeeIndex = booking?.attendees?.findIndex((attendee) => normalizeUniqueValue(attendee.fields?.[key]) === value) ?? -1;
    if (booking && attendeeIndex >= 0) return { booking, attendeeIndex };
  }
  return null;
}
