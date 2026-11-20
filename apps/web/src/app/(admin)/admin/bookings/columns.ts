/** Bookings-table columns the admin can show or hide; the choice is remembered in a cookie. */
export const BOOKING_COLUMNS_COOKIE = "tbook_booking_columns";

export const TOGGLEABLE_COLUMNS = [
  { key: "event", label: "Event" },
  { key: "total", label: "Total" },
  { key: "guests", label: "Guests / check-in" },
  { key: "status", label: "Status & tags" },
  { key: "paidVia", label: "Paid via" },
  { key: "invoice", label: "Invoice" },
] as const;

export const FIELD_PREFIX = "f:";

/** Parses the stored choice, dropping anything that is not a known column. */
export function parseColumns(raw: string | undefined, fieldKeys: string[]): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const allowed = new Set<string>([...TOGGLEABLE_COLUMNS.map((c) => c.key), ...fieldKeys.map((k) => FIELD_PREFIX + k)]);
    return parsed.filter((value): value is string => typeof value === "string" && allowed.has(value));
  } catch {
    return null;
  }
}
