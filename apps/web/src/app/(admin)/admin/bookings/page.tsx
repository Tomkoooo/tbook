import Link from "next/link";
import { cookies } from "next/headers";
import { TICKET_SALES } from "@tbook/modules";
import { WALK_IN_CUSTOMER_EMAIL, bookingStatuses, invoiceStatuses } from "@tbook/schemas";
import { listBookingFilterOptions, listBookingsForOrg, summarizeBookingGuests } from "@tbook/services";
import { CalendarX, CreditCard, Download, Plus, Ticket, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { LinkPagination } from "@/components/link-pagination";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { BOOKING_STATUS_TONES, INVOICE_STATUS_TONES, toneFor } from "@/lib/status-tones";
import { firstParam, hrefWithParams, parseSort } from "@/lib/table-sort";
import { formatDateTime, formatMoney, formatRevenue, requireAdminPage } from "@/lib/admin-page";
import { requireModule } from "@/lib/require-module";
import { BookingFilters } from "./booking-filters";
import { ColumnPicker } from "./column-picker";
import { BOOKING_COLUMNS_COOKIE, FIELD_PREFIX, TOGGLEABLE_COLUMNS, parseColumns } from "./columns";

/**
 * The booking console. All table state (filters, sort, page) lives in the
 * query string, which makes any view shareable, bookmarkable and
 * reload-safe, and means the server component can render the exact
 * requested view with no client state at all.
 */
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const one = firstParam;

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
  const off = await requireModule(organizationId, TICKET_SALES, "Ticket selling");
  if (off) return off;
  const params = await searchParams;

  const sorted = parseSort(params, SORTABLE.map((entry) => entry.key), { key: "createdAt", dir: "desc" });
  const sortBy = sorted.key as (typeof SORTABLE)[number]["key"];
  const sortDir = sorted.dir;

  const filter = {
    status: enumList(one(params, "status"), bookingStatuses),
    invoiceStatus: enumList(one(params, "invoiceStatus"), invoiceStatuses),
    eventId: one(params, "eventId"),
    groupId: one(params, "groupId"),
    search: one(params, "search"),
    tag: one(params, "tag") || undefined,
    checkIn: (one(params, "checkIn") === "in" || one(params, "checkIn") === "not_in" ? one(params, "checkIn") : undefined) as "in" | "not_in" | undefined,
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
  // Columns: the saved choice, or by default everything plus the guests' identifying answer (e.g. employee ID).
  const identifierKeys = options.guestFields.filter((field) => field.identifier).map((field) => field.key);
  const saved = parseColumns((await cookies()).get(BOOKING_COLUMNS_COOKIE)?.value, options.guestFields.map((field) => field.key));
  const visibleKeys = saved ?? [...TOGGLEABLE_COLUMNS.map((column) => column.key as string), ...identifierKeys.map((key) => FIELD_PREFIX + key)];
  const show = (key: string) => visibleKeys.includes(key);
  const shownFields = options.guestFields.filter((field) => show(FIELD_PREFIX + field.key));
  const guestSummaries = await summarizeBookingGuests(result.bookings.map((booking) => String(booking._id)));

  /** Rebuilds the current URL with some params replaced — keeps filters when paging or sorting. */
  const hrefWith = (overrides: Record<string, string | undefined>) => hrefWithParams("/admin/bookings", params, overrides);

  const FILTER_KEYS = ["search", "status", "invoiceStatus", "eventId", "groupId", "tag", "checkIn", "createdFrom", "createdTo"] as const;
  const activeFilters = FILTER_KEYS.filter((key) => firstParam(params, key)).length;

  const exportQuery = new URLSearchParams();
  if (filter.status) exportQuery.set("status", filter.status.join(","));
  if (filter.invoiceStatus) exportQuery.set("invoiceStatus", filter.invoiceStatus.join(","));
  if (filter.eventId) exportQuery.set("eventId", filter.eventId);
  if (filter.groupId) exportQuery.set("groupId", filter.groupId);
  if (filter.search) exportQuery.set("search", filter.search);
  if (filter.createdFrom) exportQuery.set("createdFrom", filter.createdFrom.toISOString());
  if (filter.createdTo) exportQuery.set("createdTo", filter.createdTo.toISOString());


  const sortLabel = new Map<string, string>(SORTABLE.map((entry) => [entry.key, entry.label]));
  type Row = (typeof result.bookings)[number];

  const columns: DataColumn<Row>[] = [
    {
      key: "createdAt",
      header: sortLabel.get("createdAt"),
      sortKey: "createdAt",
      className: "text-muted-foreground",
      cell: (booking) => formatDateTime(booking.createdAt),
    },
    {
      key: "customerName",
      header: sortLabel.get("customerName"),
      sortKey: "customerName",
      mobile: "title",
      cell: (booking) => (
        <>
          <Link className="font-medium hover:underline" href={`/admin/bookings/${String(booking._id)}`}>
            {booking.customer?.name}
          </Link>
          <div className="text-muted-foreground text-xs">
            {booking.customer?.email === WALK_IN_CUSTOMER_EMAIL ? "walk-in · printed receipt" : booking.customer?.email}
          </div>
        </>
      ),
    },
  ];
  if (show("event")) {
    columns.push({
      key: "eventName",
      header: sortLabel.get("eventName"),
      sortKey: "eventName",
      wrap: true,
      className: "min-w-48",
      cell: (booking) => (
        <>
          {booking.eventName}
          {booking.hotelName ? <div className="text-muted-foreground text-xs">{booking.hotelName}</div> : null}
        </>
      ),
    });
  }
  if (show("total")) {
    columns.push({
      key: "totalHuf",
      header: sortLabel.get("totalHuf"),
      sortKey: "totalHuf",
      align: "right",
      cell: (booking) => formatMoney(booking.totalHuf, booking.currency ?? "HUF"),
    });
  }
  for (const field of shownFields) {
    columns.push({
      key: field.key,
      header: field.label,
      wrap: true,
      cell: (booking) =>
        (booking.attendees ?? [])
          .map((attendee) => attendee.fields?.[field.key])
          .filter((value) => value !== undefined && value !== null && String(value) !== "")
          .map(String)
          .join(", ") || <span className="text-muted-foreground">–</span>,
    });
  }
  if (show("guests")) {
    columns.push({
      key: "guests",
      header: "Guests",
      align: "right",
      cell: (booking) => {
        const summary = guestSummaries.get(String(booking._id));
        return (
          <>
            {booking.guests}
            {summary ? (
              <div className="text-muted-foreground text-xs whitespace-nowrap">
                {summary.checkedIn}/{summary.guests} checked in
              </div>
            ) : null}
          </>
        );
      },
    });
  }
  if (show("status")) {
    columns.push({
      key: "status",
      header: "Status",
      cell: (booking) => {
        const summary = guestSummaries.get(String(booking._id));
        return (
          <>
            <div className="flex gap-1">
              <Badge variant={toneFor(BOOKING_STATUS_TONES, booking.status)}>{booking.status}</Badge>
              {booking.source === "admin" ? <Badge variant="info">admin</Badge> : null}
              {booking.isTest ? <Badge variant="warning">TESZT</Badge> : null}
            </div>
            {summary && summary.tags.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {summary.tags.map((tag) => (
                  <Badge key={tag} variant="note">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </>
        );
      },
    });
  }
  if (show("paidVia")) {
    columns.push({
      key: "paidVia",
      header: "Paid via",
      className: "text-muted-foreground",
      hideBelow: "lg",
      cell: (booking) => booking.paymentMethod ?? "stripe",
    });
  }
  if (show("invoice")) {
    columns.push({
      key: "invoice",
      header: "Invoice",
      cell: (booking) => (
        <div className="flex gap-1">
          <Badge variant={toneFor(INVOICE_STATUS_TONES, booking.invoiceStatus)}>{booking.invoiceStatus}</Badge>
          {booking.invoiceSource === "manual" ? <Badge variant="neutral">manual</Badge> : null}
        </div>
      ),
    });
  }
  columns.push({
    key: "open",
    header: <span className="sr-only">Actions</span>,
    align: "right",
    mobile: "footer",
    cell: (booking) => (
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/admin/bookings/${String(booking._id)}`}>Open</Link>
      </Button>
    ),
  });

  return (
    <>
      <PageTitle
        title="Bookings"
        description="Every booking in this organization, including those made through the legacy storefronts."
        actions={
          <>
            <ColumnPicker
              builtIn={TOGGLEABLE_COLUMNS.map((column) => ({ key: column.key, label: column.label }))}
              fields={options.guestFields.map((field) => ({ key: FIELD_PREFIX + field.key, label: field.label }))}
              selected={visibleKeys}
            />
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

      <KpiGrid cols={3}>
        <KpiTile label="Matching" value={result.total} hint={activeFilters > 0 ? `${activeFilters} filter${activeFilters === 1 ? "" : "s"} applied` : "all bookings"} icon={<CreditCard />} />
        <KpiTile label="Guests" value={result.paidGuests} hint="paid + confirmed" tone="info" icon={<Ticket />} />
        <KpiTile label="Revenue" value={formatRevenue(result.revenueByCurrency)} hint="paid + confirmed" tone="success" icon={<Wallet />} className="col-span-2 md:col-span-1" />
      </KpiGrid>

      <BookingFilters options={options} params={params} activeCount={activeFilters} />

      <SectionCard flush>
        <DataTable
          rows={result.bookings}
          rowKey={(booking) => String(booking._id)}
          columns={columns}
          mobileCards
          maxHeight="lg"
          caption="Bookings"
          sort={{
            state: { key: sortBy, dir: sortDir },
            hrefFor: (key, dir) => hrefWith({ sortBy: key, sortDir: dir, page: undefined }),
          }}
          empty={
            <EmptyState
              icon={<CalendarX />}
              title="No bookings match these filters"
              hint="Try clearing the search or widening the date range."
              action={
                activeFilters > 0 ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/admin/bookings">Clear filters</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        />
        {result.bookings.length > 0 ? (
          <LinkPagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            hrefForPage={(target) => hrefWith({ page: String(target) })}
          />
        ) : null}
      </SectionCard>
    </>
  );
}
