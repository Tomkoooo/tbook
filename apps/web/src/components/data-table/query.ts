import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type ColumnDef, type DataTableQuery } from "./types";

type Params = Record<string, string | string[] | undefined>;

const FILTER_PREFIX = "f.";

function list(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw.map((item) => item.trim()).filter(Boolean);
}

/**
 * URL → query. Unknown page sizes fall back to the default (or the viewer's
 * saved size), so the URL can never ask for an unbounded page.
 */
export function parseDataTableQuery(params: Params, defaults: { sort?: string; pageSize?: number; savedPageSize?: number } = {}): DataTableQuery {
  const requested = Number(list(params.pageSize)[0]);
  const fallback = PAGE_SIZES.includes((defaults.savedPageSize ?? 0) as (typeof PAGE_SIZES)[number]) ? defaults.savedPageSize! : (defaults.pageSize ?? DEFAULT_PAGE_SIZE);
  const pageSize = PAGE_SIZES.includes(requested as (typeof PAGE_SIZES)[number]) ? requested : fallback;
  const filters: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(FILTER_PREFIX)) continue;
    const values = list(value);
    if (values.length > 0) filters[key.slice(FILTER_PREFIX.length)] = values;
  }
  return {
    search: list(params.search)[0] ?? "",
    sort: list(params.sort)[0] ?? defaults.sort ?? "",
    page: Math.max(Number(list(params.page)[0]) || 1, 1),
    pageSize,
    filters,
  };
}

/** A sort string as `{ key, dir }`; only keys the column list marks sortable are accepted. */
export function parseSort(sort: string, columns: ReadonlyArray<Pick<ColumnDef<unknown>, "key" | "sortable">>): { key: string; dir: "asc" | "desc" } | null {
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  if (!columns.some((column) => column.key === key && column.sortable)) return null;
  return { key, dir: desc ? "desc" : "asc" };
}

/** Number of applied filters (a number/date range counts once). */
export function activeFilterCount(query: DataTableQuery): number {
  return Object.keys(query.filters).length;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(cellText).join(" ");
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** An array cell (tags, several machines) matches when ANY of its items is picked. */
function matchesAny(cell: unknown, values: string[]): boolean {
  return Array.isArray(cell) ? cell.some((item) => values.includes(cellText(item))) : values.includes(cellText(cell));
}

/**
 * The same query logic as the server lists, in memory — for small lists the
 * page already holds (client mode). Filters on non-`filterable` columns and
 * sorts on non-`sortable` ones are ignored, like on the server.
 */
export function applyClientQuery<T extends Record<string, unknown>>(rows: readonly T[], columns: ReadonlyArray<ColumnDef<T>>, query: DataTableQuery): { rows: T[]; total: number } {
  let result = [...rows];
  const needle = query.search.trim().toLocaleLowerCase("hu");
  if (needle) {
    const searchable = columns.filter((column) => column.searchable);
    result = result.filter((row) => searchable.some((column) => cellText(row[column.key]).toLocaleLowerCase("hu").includes(needle)));
  }
  for (const column of columns) {
    const values = query.filters[column.key];
    if (!column.filterable || !values || values.length === 0) continue;
    result = result.filter((row) => {
      const cell = row[column.key];
      switch (column.type) {
        case "number": {
          const [from, to] = values;
          const number = Number(cell);
          return (!from || number >= Number(from)) && (!to || number <= Number(to));
        }
        case "date": {
          const [from, to] = values;
          const time = cell ? new Date(cell as string | Date).getTime() : Number.NaN;
          if (Number.isNaN(time)) return false;
          const end = to ? new Date(to).setHours(23, 59, 59, 999) : Number.POSITIVE_INFINITY;
          return (!from || time >= new Date(from).getTime()) && time <= end;
        }
        case "boolean":
          return String(Boolean(cell)) === values[0];
        case "enum":
          return matchesAny(cell, values);
        default:
          return column.filterVariant === "select"
            ? matchesAny(cell, values)
            : cellText(cell).toLocaleLowerCase("hu").includes(values[0]!.toLocaleLowerCase("hu"));
      }
    });
  }
  const sort = parseSort(query.sort, columns);
  if (sort) {
    const factor = sort.dir === "desc" ? -1 : 1;
    result.sort((a, b) => {
      const left = a[sort.key];
      const right = b[sort.key];
      if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
      return cellText(left).localeCompare(cellText(right), "hu", { numeric: true }) * factor;
    });
  }
  const total = result.length;
  const start = (query.page - 1) * query.pageSize;
  return { rows: result.slice(start, start + query.pageSize), total };
}

/** Rebuilds a query string from the current one: `set` replaces, `undefined`/empty removes, others stay (e.g. `view`). */
export function withParams(current: URLSearchParams, changes: Record<string, string | string[] | undefined>): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(changes)) {
    next.delete(key);
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    for (const item of values) if (item !== "") next.append(key, item);
  }
  return next.toString();
}
