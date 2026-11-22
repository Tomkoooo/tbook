/**
 * Small helpers for URL-driven sorting (shared by DataTable and the pages
 * that already keep table state in the query string). Pure — unit-tested.
 */
export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

type Params = Record<string, string | string[] | undefined>;

/** First value of a query param, trimmed; undefined when absent or blank. */
export function firstParam(params: Params, key: string): string | undefined {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/**
 * Reads `sortBy` / `sortDir` from the query, dropping unknown keys so the URL
 * can never select a column the page does not offer.
 */
export function parseSort(params: Params, allowed: readonly string[], fallback: SortState): SortState {
  const key = firstParam(params, "sortBy");
  const dir = firstParam(params, "sortDir");
  return {
    key: key && allowed.includes(key) ? key : fallback.key,
    dir: dir === "asc" || dir === "desc" ? dir : fallback.dir,
  };
}

/** Clicking the active column flips its direction; a new column starts descending. */
export function nextSortDir(current: SortState, key: string): SortDir {
  return current.key === key && current.dir === "desc" ? "asc" : "desc";
}

/** `aria-sort` value for a header cell. */
export function ariaSort(current: SortState, key: string): "ascending" | "descending" | "none" {
  if (current.key !== key) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}

/**
 * Rebuilds a URL with some params replaced (undefined removes one), keeping
 * every other param. Paging is reset by passing `page: undefined`.
 */
export function hrefWithParams(
  basePath: string,
  params: Params,
  overrides: Record<string, string | undefined>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single) next.set(key, single);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** Stable in-memory sort for small lists that are not paged server-side. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => string | number | null | undefined, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = value(a.row);
      const right = value(b.row);
      // Empty values always sink to the bottom, whatever the direction.
      if (left == null && right == null) return a.index - b.index;
      if (left == null) return 1;
      if (right == null) return -1;
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
      return order !== 0 ? sign * order : a.index - b.index;
    })
    .map((entry) => entry.row);
}
