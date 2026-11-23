import type { TablePrefs } from "./types";

/** Cookie holding a viewer's column / page-size choices for one table. A cookie (not localStorage) so the server renders the right columns on the first paint — no layout jump after hydration. */
export function tablePrefsCookie(tableId: string): string {
  return `tbook-table-${tableId.replace(/[^\w-]/g, "_")}`;
}

/** Tolerant parse: anything unexpected reads as "no preference". */
export function parseTablePrefs(raw: string | undefined): TablePrefs | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (!value || typeof value !== "object") return undefined;
    const record = value as { columns?: unknown; pageSize?: unknown };
    const prefs: TablePrefs = {};
    if (Array.isArray(record.columns)) prefs.columns = record.columns.filter((key): key is string => typeof key === "string").slice(0, 100);
    if (typeof record.pageSize === "number") prefs.pageSize = record.pageSize;
    return prefs;
  } catch {
    return undefined;
  }
}
