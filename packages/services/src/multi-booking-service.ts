import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { bookingRepository, type IBooking } from "@tbook/db";
import type { PriceQuoteResult } from "@tbook/domain";
import type { BillingInfo, BookingAttendee, Customer, Selections } from "@tbook/schemas";
import { createPendingBooking, expireBooking, quote, type QuoteOptions, type QuoteRequest } from "./booking-service";

/**
 * Several events booked and paid together (v1 `entries` body, the plugin's
 * TBookMultiBookingWizard). Each event still gets its own booking, built by
 * the single-event path, so pricing, capacity, attendee and eligibility
 * rules are identical. The bookings share a `checkoutBundleId` and one
 * Stripe session.
 *
 * Lodging (same as the legacy plugin):
 * - `combined`: one hotel stay for the whole bundle, priced on the first
 *   entry; the other entries are entry-only.
 * - `separate`: each entry carries its own hotel, nights and selections.
 */

export const MAX_MULTI_BOOKING_ENTRIES = 20;

export type MultiLodgingMode = "combined" | "separate";

export interface MultiBookingEntry {
  eventId: string;
  guests: number;
  accommodationGuests?: number | null;
  teamMemberCount?: number | null;
  hotelId?: string | null;
  nights?: number | null;
  selections?: Selections | null;
  attendees?: BookingAttendee[] | null;
}

export interface MultiQuoteRequest {
  lodgingMode?: MultiLodgingMode;
  entries: MultiBookingEntry[];
  /** Shared stay when lodgingMode is `combined`. */
  hotelId?: string | null;
  nights?: number | null;
  selections?: Selections | null;
  accommodationGuests?: number | null;
}

export interface CreateMultiBookingInput extends MultiQuoteRequest {
  customer: Customer;
  billing?: BillingInfo | null;
  returnBaseUrl?: string | null;
}

export interface MultiQuoteResult {
  lodgingMode: MultiLodgingMode;
  entries: Array<{ eventId: string; eventName: string; quote: PriceQuoteResult }>;
  quote: PriceQuoteResult;
  currency: string;
}

function normalizeRequest<T extends MultiQuoteRequest>(input: T): T & { lodgingMode: MultiLodgingMode } {
  if (!input || typeof input !== "object") throw ActionError.validation("Invalid request body.");
  const lodgingMode = input.lodgingMode ?? "combined";
  if (lodgingMode !== "combined" && lodgingMode !== "separate") {
    throw ActionError.validation('lodgingMode must be "combined" or "separate".');
  }
  const entries = input.entries;
  if (!Array.isArray(entries) || entries.length === 0) throw ActionError.validation("Add at least one event.");
  if (entries.length > MAX_MULTI_BOOKING_ENTRIES) {
    throw ActionError.validation(`At most ${MAX_MULTI_BOOKING_ENTRIES} events can be booked together.`);
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry.eventId !== "string" || !Types.ObjectId.isValid(entry.eventId)) {
      throw ActionError.validation("Every entry needs a valid eventId.");
    }
    if (!Number.isInteger(entry.guests) || entry.guests < 1) throw ActionError.validation("Every entry needs at least one guest.");
    if (seen.has(entry.eventId)) throw ActionError.validation("The same event is listed twice.");
    seen.add(entry.eventId);
  }
  return { ...input, lodgingMode };
}

/** The single-event request for entry `index`, with the bundle's lodging applied. */
function entryRequest(input: MultiQuoteRequest & { lodgingMode: MultiLodgingMode }, index: number): QuoteRequest {
  const entry = input.entries[index]!;
  const base = { eventId: entry.eventId, guests: entry.guests, teamMemberCount: entry.teamMemberCount };
  if (input.lodgingMode === "separate") {
    return { ...base, accommodationGuests: entry.accommodationGuests, hotelId: entry.hotelId, nights: entry.nights, selections: entry.selections };
  }
  if (index === 0) {
    return {
      ...base,
      accommodationGuests: input.accommodationGuests ?? entry.accommodationGuests,
      hotelId: input.hotelId,
      nights: input.nights,
      selections: input.selections,
    };
  }
  return { ...base, accommodationGuests: 0, hotelId: null, nights: null, selections: null };
}

function sumQuotes(rows: MultiQuoteResult["entries"]): PriceQuoteResult {
  const sum = (pick: (q: PriceQuoteResult) => number) => rows.reduce((total, row) => total + pick(row.quote), 0);
  return {
    guests: sum((q) => q.guests),
    accommodationGuests: sum((q) => q.accommodationGuests),
    nights: rows.reduce((max, row) => Math.max(max, row.quote.nights), 0),
    ticketSubtotalHuf: sum((q) => q.ticketSubtotalHuf),
    accommodationBaseHuf: sum((q) => q.accommodationBaseHuf),
    accommodationOptionsHuf: sum((q) => q.accommodationOptionsHuf),
    accommodationSubtotalHuf: sum((q) => q.accommodationSubtotalHuf),
    totalHuf: sum((q) => q.totalHuf),
    lines: rows.flatMap((row) =>
      row.quote.lines.map((line) => ({ ...line, key: `${row.eventId}:${line.key}`, label: `${row.eventName}: ${line.label}` })),
    ),
  };
}

/**
 * Prices every entry and the bundle total. All events must be in the same
 * currency, because they are paid in one Stripe session.
 */
export async function quoteMulti(input: MultiQuoteRequest, opts?: QuoteOptions): Promise<MultiQuoteResult> {
  const request = normalizeRequest(input);
  const entries: MultiQuoteResult["entries"] = [];
  let currency: string | null = null;

  for (let index = 0; index < request.entries.length; index++) {
    const ctx = await quote(entryRequest(request, index), opts);
    if (currency && ctx.currency !== currency) {
      throw ActionError.validation("These events are sold in different currencies and can't be paid together.");
    }
    currency = ctx.currency;
    entries.push({ eventId: String(ctx.event._id), eventName: ctx.event.name, quote: ctx.quote });
  }

  return { lodgingMode: request.lodgingMode, entries, quote: sumQuotes(entries), currency: currency ?? "HUF" };
}

/**
 * Creates one pending booking per entry, all sharing a new checkoutBundleId.
 * All or nothing: if any entry fails, the bookings already created are
 * expired, which gives their capacity back.
 */
export async function createPendingMultiBookings(
  input: CreateMultiBookingInput,
  opts?: QuoteOptions,
): Promise<{ bookings: IBooking[]; checkoutBundleId: string }> {
  const request = normalizeRequest(input);
  // Validates currencies, sales windows and lodging up front, before
  // anything is reserved.
  await quoteMulti(request, opts);

  const checkoutBundleId = new Types.ObjectId().toString();
  const bookings: IBooking[] = [];
  try {
    for (let index = 0; index < request.entries.length; index++) {
      const created = await createPendingBooking(
        {
          ...entryRequest(request, index),
          customer: request.customer,
          billing: request.billing,
          returnBaseUrl: request.returnBaseUrl,
          attendees: request.entries[index]!.attendees,
        },
        opts,
      );
      bookings.push(created);
      const tagged = await bookingRepository.updateById(String(created._id), { checkoutBundleId });
      if (tagged) bookings[bookings.length - 1] = tagged;
    }
  } catch (error) {
    await releaseMultiBookings(bookings);
    throw error;
  }
  return { bookings, checkoutBundleId };
}

/** Expires the given bookings (best effort) and gives their capacity back. */
export async function releaseMultiBookings(bookings: IBooking[]): Promise<void> {
  for (const booking of bookings) {
    try {
      await expireBooking(String(booking._id));
    } catch (error) {
      console.error("[tbook] failed to release multi-booking entry", String(booking._id), error);
    }
  }
}
