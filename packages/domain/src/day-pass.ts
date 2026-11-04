import type { DayPassConfig, DayPassDiscountCode, PriceBasis } from "@tbook/schemas";
import type { PriceQuoteResult } from "./pricing";
import { toGrossAmount } from "./vat";

/**
 * Pure logic for day-pass events: a long-running event (say a month of
 * play) where the buyer picks individual days and a number of passes per
 * day, priced at a weekday or weekend rate with a capacity per day.
 *
 * Days are `yyyy-mm-dd` strings throughout, derived from the event's
 * start/end dates by their UTC calendar date. Strings rather than Date
 * objects because they are the keys of the per-day maps stored on the
 * event, and because a calendar day has no time zone of its own — only
 * "which day is today" does, and that is the one place a zone is applied.
 */

/** Where the per-day ticket basket travels in `Selections`. */
export const DAY_PASS_SELECTION_KEY = "dayPasses";

/** Matches the venue, not the server — a pass bought for Saturday is for Saturday in Budapest. */
export const DEFAULT_EVENT_TIME_ZONE = "Europe/Budapest";

export type DayTickets = Record<string, number>;

export function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every calendar day from start to end inclusive. */
export function eventDayKeys(startDate: Date, endDate: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${dayKeyOf(startDate)}T00:00:00Z`);
  const last = new Date(`${dayKeyOf(endDate)}T00:00:00Z`);
  // Guard against a malformed range turning into an unbounded loop.
  for (let i = 0; cursor <= last && i < 400; i++) {
    keys.push(dayKeyOf(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

/** The calendar day it currently is at the venue. */
export function todayDayKey(now: Date, timeZone: string = DEFAULT_EVENT_TIME_ZONE): string {
  // en-CA formats as yyyy-mm-dd.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isWeekendDay(dayKey: string, weekendDays: number[]): boolean {
  return weekendDays.includes(new Date(`${dayKey}T00:00:00Z`).getUTCDay());
}

export function dayPriceHuf(config: DayPassConfig, dayKey: string): number {
  return isWeekendDay(dayKey, config.weekendDays) ? config.weekendPriceHuf : config.weekdayPriceHuf;
}

/**
 * Looks up an enabled discount code by name (trimmed, case-insensitive).
 * Returns null for no code, an unknown code, or one that's been disabled —
 * callers that need to tell "no code given" apart from "bad code" check
 * `code` before calling this.
 */
export function resolveDayPassDiscountCode(config: DayPassConfig, code: string | null | undefined): DayPassDiscountCode | null {
  const normalized = code?.trim().toUpperCase();
  if (!normalized) return null;
  return config.discountCodes.find((entry) => entry.enabled && entry.code.trim().toUpperCase() === normalized) ?? null;
}

/** Applies a resolved discount's percent-off to a base price, never below zero. */
function discountedPriceHuf(baseHuf: number, discount: DayPassDiscountCode | null | undefined): number {
  if (!discount) return baseHuf;
  return Math.max(0, baseHuf * (1 - discount.percentOff / 100));
}

/** Passes available on a day; null means unlimited. */
export function dayCapacity(config: DayPassConfig, dayKey: string): number | null {
  const override = config.capacityOverrides[dayKey];
  return override !== undefined ? override : config.dailyCapacity;
}

export function totalDayTickets(tickets: DayTickets): number {
  return Object.values(tickets).reduce((sum, qty) => sum + qty, 0);
}

/**
 * Reads the basket out of `Selections`. Anything malformed — wrong shape,
 * fractional or non-positive counts — is reported rather than coerced, so
 * a buggy client can't silently buy a different basket than it showed.
 */
export function parseDayTickets(selections: Record<string, unknown> | null | undefined): { tickets: DayTickets; errors: string[] } {
  const raw = selections?.[DAY_PASS_SELECTION_KEY];
  if (raw === undefined || raw === null) return { tickets: {}, errors: ["Choose at least one day."] };
  if (typeof raw !== "object" || Array.isArray(raw)) return { tickets: {}, errors: ["The day selection is malformed."] };

  const tickets: DayTickets = {};
  const errors: string[] = [];
  for (const [dayKey, qty] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      errors.push(`"${dayKey}" is not a valid date.`);
      continue;
    }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0) {
      errors.push(`The ticket count for ${dayKey} must be a whole number.`);
      continue;
    }
    if (qty > 0) tickets[dayKey] = qty;
  }
  if (errors.length === 0 && Object.keys(tickets).length === 0) errors.push("Choose at least one day.");
  return { tickets, errors };
}

export interface DayAvailability {
  date: string;
  weekend: boolean;
  /** Unit price in the event's own basis (not yet grossed up). */
  priceHuf: number;
  capacity: number | null;
  sold: number;
  /** Null = unlimited. */
  remaining: number | null;
  closed: boolean;
}

/** One row per day of the event, for the storefront/POS day picker and the admin availability table. */
export function dayAvailability(input: {
  config: DayPassConfig;
  startDate: Date;
  endDate: Date;
  daySold: Record<string, number> | null | undefined;
}): DayAvailability[] {
  return eventDayKeys(input.startDate, input.endDate).map((date) => {
    const capacity = dayCapacity(input.config, date);
    const sold = input.daySold?.[date] ?? 0;
    return {
      date,
      weekend: isWeekendDay(date, input.config.weekendDays),
      priceHuf: dayPriceHuf(input.config, date),
      capacity,
      sold,
      remaining: capacity === null ? null : Math.max(capacity - sold, 0),
      closed: input.config.closedDays.includes(date),
    };
  });
}

export interface DayTicketIssue {
  date: string | null;
  message: string;
}

/**
 * Checks a basket against the event. Capacity is checked here only as a
 * friendly early answer; the authoritative check is the atomic reservation
 * in the repository, which is what actually prevents overselling.
 */
export function validateDayTickets(input: {
  config: DayPassConfig;
  startDate: Date;
  endDate: Date;
  tickets: DayTickets;
  daySold: Record<string, number> | null | undefined;
  today: string;
  /** Console/seller overrides. */
  allowPastDays?: boolean;
  allowOverCapacity?: boolean;
}): DayTicketIssue[] {
  const issues: DayTicketIssue[] = [];
  const days = new Set(eventDayKeys(input.startDate, input.endDate));

  for (const [date, qty] of Object.entries(input.tickets)) {
    if (!days.has(date)) {
      issues.push({ date, message: `${date} is outside this event.` });
      continue;
    }
    if (input.config.closedDays.includes(date)) {
      issues.push({ date, message: `No passes are sold for ${date}.` });
      continue;
    }
    if (!input.allowPastDays && date < input.today) {
      issues.push({ date, message: `${date} has already passed.` });
      continue;
    }
    const capacity = dayCapacity(input.config, date);
    if (!input.allowOverCapacity && capacity !== null) {
      const remaining = Math.max(capacity - (input.daySold?.[date] ?? 0), 0);
      if (qty > remaining) {
        issues.push({ date, message: remaining === 0 ? `${date} is sold out.` : `Only ${remaining} pass(es) left for ${date}.` });
      }
    }
  }
  return issues;
}

/** One entry per ticket, ordered by date — pairs the basket with the booking's attendee/voucher indexes. */
export function expandDayTickets(tickets: DayTickets): string[] {
  return Object.keys(tickets)
    .sort()
    .flatMap((date) => Array.from({ length: tickets[date]! }, () => date));
}

const roundMoney = (amount: number) => Math.round(Number.isFinite(amount) ? amount : 0);

/** Prices a basket. Same result shape as calculateBookingQuote so it drops into the booking record unchanged. */
export function calculateDayPassQuote(input: {
  config: DayPassConfig;
  tickets: DayTickets;
  priceBasis: PriceBasis;
  vatPercent: number;
  /** Already resolved via resolveDayPassDiscountCode — this function doesn't look codes up itself. */
  discount?: DayPassDiscountCode | null;
}): PriceQuoteResult {
  const lines = Object.keys(input.tickets)
    .sort()
    .map((date) => {
      const qty = input.tickets[date]!;
      const basePrice = Math.max(0, dayPriceHuf(input.config, date));
      const unitGross = roundMoney(toGrossAmount(discountedPriceHuf(basePrice, input.discount), input.priceBasis, input.vatPercent));
      const kind = isWeekendDay(date, input.config.weekendDays) ? "weekend" : "weekday";
      const discountSuffix = input.discount ? `, ${input.discount.label || input.discount.code} −${input.discount.percentOff}%` : "";
      return {
        // "ticket:" keeps invoice VAT resolution on the ticket rate.
        key: `ticket:${date}`,
        label: `Day pass ${date} (${kind}${discountSuffix})${qty > 1 ? ` × ${qty}` : ""}`,
        amountHuf: unitGross * qty,
      };
    });

  const total = lines.reduce((sum, line) => sum + line.amountHuf, 0);
  return {
    guests: totalDayTickets(input.tickets),
    accommodationGuests: 0,
    nights: 0,
    ticketSubtotalHuf: total,
    accommodationBaseHuf: 0,
    accommodationOptionsHuf: 0,
    accommodationSubtotalHuf: 0,
    totalHuf: total,
    lines,
  };
}
