/**
 * Pure display formatters, safe in server and client components. Dates always
 * use the organizer's time zone, so the server render and the browser agree
 * (no hydration mismatch, no flicker).
 */
const TIME_ZONE = "Europe/Budapest";

/**
 * Formats money the way the whole console shows it.
 *
 * `currency` is required and has no default on purpose: the previous
 * version defaulted to HUF, which rendered the Magyar Darts Szövetség's
 * EUR revenue as "23 561 Ft". A booking's amount lives in `booking.currency`
 * (the `totalHuf` field name is a legacy misnomer), so every call site has
 * one and must pass it.
 */
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("hu-HU", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

/** Renders a multi-currency revenue total as one string, e.g. "23 561 €" or "… + …". */
export function formatRevenue(entries: Array<{ currency: string; totalHuf: number }>): string {
  if (entries.length === 0) return formatMoney(0, "HUF");
  return entries.map((entry) => formatMoney(entry.totalHuf, entry.currency)).join(" + ");
}

/** Formats a timestamp for the console's tables (local, minute precision). */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("hu-HU", { dateStyle: "short", timeStyle: "short", timeZone: TIME_ZONE }).format(new Date(value));
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium", timeZone: TIME_ZONE }).format(new Date(value));
}

