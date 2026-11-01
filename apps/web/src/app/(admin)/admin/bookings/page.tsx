import Link from "next/link";
import { WALK_IN_CUSTOMER_EMAIL, bookingStatuses, invoiceStatuses } from "@tbook/schemas";
import { listBookingFilterOptions, listBookingsForOrg } from "@tbook/services";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { LinkPagination } from "@/components/link-pagination";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { Stat } from "@/components/stat";
import { BOOKING_STATUS_TONES, INVOICE_STATUS_TONES, toneFor } from "@/lib/status-tones";
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
      <PageTitle
        title="Bookings"
        description="Every booking in this organization, including those made through the legacy storefronts."
        actions={
          <>
            {permissions.has("booking:export") ? (
              <Button variant="outline" asChild>
                <a href={`/api/v2/admin/bookings/export?${exportQuery.toString()}`}>
                  <Download /> Export CSV
                </a>
              </Button>
            ) : null}
            {permissions.has("booking:manage") ? (
              <Button asChild>
                <Link href="/admin/bookings/new">
                  <Plus /> New registration
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Matching" value={result.total} />
        <Stat label="Guests" value={result.paidGuests} hint="paid + confirmed" />
        <Stat label="Revenue" value={formatRevenue(result.revenueByCurrency)} hint="paid + confirmed" />
      </div>

      <SectionCard title="Filters">
        <BookingFilters options={options} params={params} />
      </SectionCard>

      <SectionCard flush>
        {result.bookings.length === 0 ? (
          <EmptyState title="No bookings match these filters" hint="Try clearing the search or widening the date range." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  {SORTABLE.map((column) => {
                    const active = sortBy === column.key;
                    const nextDir = active && sortDir === "desc" ? "asc" : "desc";
                    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
                    return (
                      <TableHead
                        key={column.key}
                        className={column.key === "totalHuf" ? "text-right" : undefined}
                        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                      >
                        <Link
                          className="hover:text-foreground inline-flex items-center gap-1"
                          href={hrefWith({ sortBy: column.key, sortDir: nextDir, page: undefined })}
                        >
                          {column.label}
                          <Icon className={active ? "size-3.5" : "size-3.5 opacity-40"} />
                        </Link>
                      </TableHead>
                    );
                  })}
                  <TableHead className="text-right">Guests</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid via</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.bookings.map((booking) => {
                  const id = String(booking._id);
                  return (
                    <TableRow key={id}>
                      <TableCell className="text-muted-foreground">{formatDateTime(booking.createdAt)}</TableCell>
                      <TableCell>
                        <Link className="font-medium hover:underline" href={`/admin/bookings/${id}`}>
                          {booking.customer?.name}
                        </Link>
                        <div className="text-muted-foreground text-xs">
                          {booking.customer?.email === WALK_IN_CUSTOMER_EMAIL ? "walk-in · printed receipt" : booking.customer?.email}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-48 whitespace-normal">
                        {booking.eventName}
                        {booking.hotelName ? <div className="text-muted-foreground text-xs">{booking.hotelName}</div> : null}
                      </TableCell>
                      <TableCell className="text-right">{formatMoney(booking.totalHuf, booking.currency ?? "HUF")}</TableCell>
                      <TableCell className="text-right">{booking.guests}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Badge variant={toneFor(BOOKING_STATUS_TONES, booking.status)}>{booking.status}</Badge>
                          {booking.source === "admin" ? <Badge variant="info">admin</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{booking.paymentMethod ?? "stripe"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Badge variant={toneFor(INVOICE_STATUS_TONES, booking.invoiceStatus)}>{booking.invoiceStatus}</Badge>
                          {booking.invoiceSource === "manual" ? <Badge variant="neutral">manual</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/bookings/${id}`}>Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <LinkPagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              hrefForPage={(target) => hrefWith({ page: String(target) })}
            />
          </>
        )}
      </SectionCard>
    </>
  );
}
