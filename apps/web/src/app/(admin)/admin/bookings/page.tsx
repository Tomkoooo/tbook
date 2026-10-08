import Link from "next/link";
import { bookingStatuses, invoiceStatuses } from "@tbook/schemas";
import { listBookingFilterOptions, listBookingsForOrg } from "@tbook/services";
import {
  BOOKING_STATUS_TONES,
  Badge,
  Card,
  EmptyState,
  INVOICE_STATUS_TONES,
  PageHeader,
  Pagination,
  Stat,
  StatRow,
  Table,
} from "@tbook/ui";
import { formatDateTime, formatMoney, formatRevenue, requireAdminPage } from "@/lib/admin-page";
import { BookingFilters } from "./booking-filters";

/**
 * The booking console. All table state (filters, sort, page) lives in the
 * query string, which makes any view shareable, bookmarkable and
 * reload-safe, and means the server component can render the exact
 * requested view with no client state at all.
 */
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/** Narrows a query param to a known enum value, dropping anything unrecognized. */
function enumList<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is T => (allowed as readonly string[]).includes(value));
  return values.length > 0 ? values : undefined;
}

/** Parses a date input, ignoring an unparseable one rather than erroring the page. */
function date(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const SORTABLE = [
  { key: "createdAt", label: "Booked" },
  { key: "customerName", label: "Customer" },
  { key: "eventName", label: "Event" },
  { key: "totalHuf", label: "Total" },
] as const;

export default async function BookingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { organizationId, permissions } = await requireAdminPage("booking:read");
  const params = await searchParams;

  const sortByRaw = one(params, "sortBy");
  const sortBy = (SORTABLE.find((entry) => entry.key === sortByRaw)?.key ?? "createdAt") as (typeof SORTABLE)[number]["key"];
  const sortDir = one(params, "sortDir") === "asc" ? "asc" : "desc";

  const filter = {
    status: enumList(one(params, "status"), bookingStatuses),
    invoiceStatus: enumList(one(params, "invoiceStatus"), invoiceStatuses),
    eventId: one(params, "eventId"),
    groupId: one(params, "groupId"),
    search: one(params, "search"),
    createdFrom: date(one(params, "createdFrom")),
    // An end date from a date input means "the whole of that day", so it is
    // pushed to the day's last moment — otherwise a same-day filter returns
    // nothing, which reads as a bug.
    createdTo: (() => {
      const parsed = date(one(params, "createdTo"));
      if (!parsed) return undefined;
      parsed.setHours(23, 59, 59, 999);
      return parsed;
    })(),
  };

  const page = Math.max(Number(one(params, "page") ?? 1) || 1, 1);

  const [result, options] = await Promise.all([
    listBookingsForOrg(organizationId, { ...filter, page, pageSize: 25, sortBy, sortDir }),
    listBookingFilterOptions(organizationId),
  ]);

  /** Rebuilds the current URL with some params replaced — keeps filters when paging or sorting. */
  function hrefWith(overrides: Record<string, string | undefined>): string {
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
    return query ? `/admin/bookings?${query}` : "/admin/bookings";
  }

  const exportQuery = new URLSearchParams();
  if (filter.status) exportQuery.set("status", filter.status.join(","));
  if (filter.invoiceStatus) exportQuery.set("invoiceStatus", filter.invoiceStatus.join(","));
  if (filter.eventId) exportQuery.set("eventId", filter.eventId);
  if (filter.groupId) exportQuery.set("groupId", filter.groupId);
  if (filter.search) exportQuery.set("search", filter.search);
  if (filter.createdFrom) exportQuery.set("createdFrom", filter.createdFrom.toISOString());
  if (filter.createdTo) exportQuery.set("createdTo", filter.createdTo.toISOString());


  return (
    <>
      <PageHeader
        title="Bookings"
        description="Every booking in this organization, including those made through the legacy storefronts."
        actions={
          <>
            {permissions.has("booking:manage") ? (
              <Link className="tbook-btn tbook-btn-primary" href="/admin/bookings/new">
                New registration
              </Link>
            ) : null}
            {permissions.has("booking:export") ? (
              <a
                className="tbook-btn tbook-btn-secondary"
                href={`/api/v2/admin/bookings/export?${exportQuery.toString()}`}
              >
                Export CSV
              </a>
            ) : null}
          </>
        }
      />

      <StatRow>
        <Stat label="Matching" value={result.total} />
        <Stat label="Guests" value={result.paidGuests} hint="paid + confirmed" />
        <Stat label="Revenue" value={formatRevenue(result.revenueByCurrency)} hint="paid + confirmed" />
      </StatRow>

      <Card title="Filters">
        <BookingFilters options={options} params={params} />
      </Card>

      <Card>
        <div className="tbook-card-body-flush">
          {result.bookings.length === 0 ? (
            <EmptyState title="No bookings match these filters" hint="Try clearing the search or widening the date range." />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    {SORTABLE.map((column) => {
                      const active = sortBy === column.key;
                      const nextDir = active && sortDir === "desc" ? "asc" : "desc";
                      return (
                        <th key={column.key} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                          <Link href={hrefWith({ sortBy: column.key, sortDir: nextDir, page: undefined })}>
                            {column.label}
                            {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                          </Link>
                        </th>
                      );
                    })}
                    <th className="tbook-num">Guests</th>
                    <th>Status</th>
                    <th>Paid via</th>
                    <th>Invoice</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {result.bookings.map((booking) => {
                    const id = String(booking._id);
                    return (
                      <tr key={id}>
                        <td className="tbook-faint">{formatDateTime(booking.createdAt)}</td>
                        <td>
                          <Link href={`/admin/bookings/${id}`}>{booking.customer?.name}</Link>
                          <div className="tbook-faint">{booking.customer?.email}</div>
                        </td>
                        <td className="tbook-wrap">
                          {booking.eventName}
                          {booking.hotelName ? <div className="tbook-faint">{booking.hotelName}</div> : null}
                        </td>
                        <td className="tbook-num">{formatMoney(booking.totalHuf, booking.currency ?? "HUF")}</td>
                        <td className="tbook-num">{booking.guests}</td>
                        <td>
                          <Badge tone={BOOKING_STATUS_TONES[booking.status] ?? "neutral"}>{booking.status}</Badge>
                          {booking.source === "admin" ? <Badge tone="info">admin</Badge> : null}
                        </td>
                        <td className="tbook-faint">{booking.paymentMethod ?? "stripe"}</td>
                        <td>
                          <Badge tone={INVOICE_STATUS_TONES[booking.invoiceStatus] ?? "neutral"}>
                            {booking.invoiceStatus}
                          </Badge>
                          {booking.invoiceSource === "manual" ? <Badge tone="neutral">manual</Badge> : null}
                        </td>
                        <td>
                          <Link className="tbook-btn tbook-btn-ghost tbook-btn-sm" href={`/admin/bookings/${id}`}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination
                page={result.page}
                pageCount={result.pageCount}
                total={result.total}
                hrefForPage={(target) => hrefWith({ page: String(target) })}
              />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
