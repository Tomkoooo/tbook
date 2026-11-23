import { bookingStatuses, invoiceStatuses } from "@tbook/schemas";
import type { AttendeeListQuery } from "@tbook/services";
import { parseDataTableQuery, parseSort, type ColumnDef, type DataTableQuery } from "@/components/data-table";
import { ANSWER_PREFIX, BOOKING_SORT_KEYS } from "./list-columns";

type Params = Record<string, string | string[] | undefined>;

const first = (query: DataTableQuery, key: string, legacy?: string): string | undefined => query.filters[key]?.[0] || legacy || undefined;

function legacyParam(params: Params, key: string): string | undefined {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

function enumList<T extends string>(values: string[] | undefined, allowed: readonly T[]): T[] | undefined {
  const picked = (values ?? []).flatMap((value) => value.split(",")).filter((value): value is T => (allowed as readonly string[]).includes(value));
  return picked.length > 0 ? picked : undefined;
}

/** Parses a date input; an unparseable one is ignored rather than erroring the page. */
function day(raw: string | undefined, endOfDay = false): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // An end date from a date input means "the whole of that day".
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  return parsed;
}

/**
 * The bookings list's URL → the service filter. Reads the engine's params
 * (`f.status`, `search`, `sort`…) and, for old bookmarks and dashboard links,
 * the plain ones (`?status=paid`, `?eventId=…`) that predate the engine.
 */
export function bookingQueryFromParams(params: Params, columns: ColumnDef<never>[], pageSize: number | undefined, presetEventId?: string) {
  const query = parseDataTableQuery(params, { sort: "-createdAt", savedPageSize: pageSize });
  const sort = parseSort(query.sort, columns as ColumnDef<unknown>[]);
  const sortKey = BOOKING_SORT_KEYS[sort?.key ?? "createdAt"] ?? "createdAt";
  const checkIn = first(query, "guests", legacyParam(params, "checkIn"));
  const range = query.filters.createdAt ?? [];
  return {
    query,
    filter: {
      status: enumList(query.filters.status ?? (legacyParam(params, "status") ? [legacyParam(params, "status")!] : undefined), bookingStatuses),
      invoiceStatus: enumList(query.filters.invoiceStatus ?? (legacyParam(params, "invoiceStatus") ? [legacyParam(params, "invoiceStatus")!] : undefined), invoiceStatuses),
      eventId: presetEventId ?? first(query, "eventName", legacyParam(params, "eventId")),
      groupId: presetEventId ? undefined : first(query, "groupName", legacyParam(params, "groupId")),
      search: query.search || legacyParam(params, "search"),
      tag: first(query, "tags", legacyParam(params, "tag")),
      checkIn: (checkIn === "in" || checkIn === "not_in" ? checkIn : undefined) as "in" | "not_in" | undefined,
      createdFrom: day(range[0] || legacyParam(params, "createdFrom")),
      createdTo: day(range[1] || legacyParam(params, "createdTo"), true),
    },
    sortBy: sortKey,
    sortDir: (sort?.dir ?? "desc") as "asc" | "desc",
  };
}

/** The attendees list's URL → the service query (shared by the page and its CSV export). */
export function attendeeQueryFromParams(params: Params, columns: ColumnDef<never>[], pageSize: number | undefined, presetEventId?: string): { query: DataTableQuery; filter: AttendeeListQuery } {
  const query = parseDataTableQuery(params, { sort: "name", savedPageSize: pageSize });
  const sort = parseSort(query.sort, columns as ColumnDef<unknown>[]);
  const sortBy = !sort ? undefined : sort.key.startsWith(ANSWER_PREFIX) ? `answer:${sort.key.slice(ANSWER_PREFIX.length)}` : ({ name: "name", registrationNumber: "registrationNumber", status: "status", eventName: "event" } as Record<string, string>)[sort.key];
  const answers: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(query.filters)) if (key.startsWith(ANSWER_PREFIX)) answers[key.slice(ANSWER_PREFIX.length)] = values;
  return {
    query,
    filter: {
      eventId: presetEventId ?? first(query, "eventName"),
      search: query.search || undefined,
      status: query.filters.status,
      tags: query.filters.tags,
      answers,
      sortBy: sortBy ?? "name",
      sortDir: sort?.dir ?? "asc",
      page: query.page,
      pageSize: query.pageSize,
    },
  };
}
