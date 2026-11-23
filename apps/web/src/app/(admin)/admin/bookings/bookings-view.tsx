import Link from "next/link";
import type { Permission } from "@tbook/schemas";
import { listAttendeesForOrg, listBookingFilterOptions, listBookingsForOrg, summarizeBookingGuests } from "@tbook/services";
import { CreditCard, Plus, ScanLine, Ticket, UserCheck, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { PageTitle } from "@/components/page-title";
import { formatRevenue } from "@/lib/format";
import { eventPath } from "@/lib/event-routes";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { readTablePrefs } from "@/lib/table-prefs";
import { cn } from "@/lib/utils";
import { activeFilterCount } from "@/components/data-table";
import { AttendeeBreakdowns } from "./attendee-breakdown";
import { AttendeesTable } from "./attendees-table";
import { BookingsTable } from "./bookings-table";
import { ANSWER_PREFIX, attendeeColumns, bookingColumns, type AttendeeTableRow, type BookingRow, type ListOptions } from "./list-columns";
import { attendeeQueryFromParams, bookingQueryFromParams } from "./list-query";

/**
 * The booking list, shared by `/admin/bookings` (every event in the
 * organization) and `/admin/events/[eventId]/bookings` (one event: pass
 * `event`, and the event and group filters disappear). Two views over the same
 * data: **Bookings** (one row per purchase) and **Attendees** (one row per
 * guest, the registration answers as columns, plus how the answers split).
 * All table state lives in the URL (`view`, `search`, `sort`, `page`,
 * `f.<column>`), so any view is shareable and reload-safe.
 *
 * The pages do the auth and module guards; this renders.
 */

type SearchParams = Record<string, string | string[] | undefined>;

export async function BookingsView({
  organizationId,
  permissions,
  params,
  event,
}: {
  organizationId: string;
  permissions: Set<Permission>;
  params: SearchParams;
  /** Set on the event page: the list is preset to this event. */
  event?: { id: string; name: string };
}) {
  const basePath = event ? eventPath(event.id, "bookings") : "/admin/bookings";
  const view = params.view === "attendees" ? "attendees" : "bookings";
  const options = await listBookingFilterOptions(organizationId);

  const tabClass = (active: boolean) => cn("inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-sm font-medium", active ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground");
  const viewTabs = (
    <div className="bg-muted inline-flex rounded-lg p-0.5" role="tablist" aria-label="View">
      <Link href={basePath} role="tab" aria-selected={view === "bookings"} className={tabClass(view === "bookings")}>
        <CreditCard className="size-3.5" />
        Bookings
      </Link>
      <Link href={`${basePath}?view=attendees`} role="tab" aria-selected={view === "attendees"} className={tabClass(view === "attendees")}>
        <Users className="size-3.5" />
        Attendees
      </Link>
    </div>
  );

  const newRegistrationHref = event ? eventPath(event.id, "bookings", "new") : null;
  const title = (
    <PageTitle
      title={view === "attendees" ? "Attendees" : "Bookings"}
      description={
        view === "attendees"
          ? event
            ? `Everyone with a ticket to ${event.name}, with what they answered at registration.`
            : "Everyone with a ticket, one row per guest, with what they answered at registration."
          : event
            ? `Bookings of ${event.name}.`
            : "Every booking in this organization, including those made through the legacy storefronts."
      }
      actions={
        newRegistrationHref && hasPermissionOrFallback(permissions, "booking:manage") ? (
          <Button asChild>
            <Link href={newRegistrationHref}>
              <Plus /> New registration
            </Link>
          </Button>
        ) : null
      }
    />
  );

  const eventOptions = options.events.map(({ id, name }) => ({ id, name }));

  if (view === "attendees") {
    const prefs = await readTablePrefs("attendees");
    // The columns depend on which questions the events ask, so read the (cheap) field list first.
    const probe = await listAttendeesForOrg(organizationId, { eventId: event?.id, pageSize: 1, withBreakdown: false });
    const listOptions: ListOptions = { eventPreset: Boolean(event), groups: options.groups, events: eventOptions, tags: options.tags, fields: probe.fields };
    const columns = attendeeColumns(listOptions);
    const { query, filter } = attendeeQueryFromParams(params, columns as never, prefs?.pageSize, event?.id);
    const result = await listAttendeesForOrg(organizationId, filter);

    const rows: AttendeeTableRow[] = result.rows.map((row) => {
      const out: AttendeeTableRow = {
        id: row.id,
        bookingId: row.bookingId,
        eventId: row.eventId,
        eventName: row.eventName,
        name: row.name,
        registrationNumber: row.registrationNumber,
        status: row.status,
        checkedInAt: row.checkedInAt,
        tags: row.tags,
        buyer: row.buyer,
      };
      for (const [key, value] of Object.entries(row.answers)) out[ANSWER_PREFIX + key] = value;
      return out;
    });

    const exportParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const items = Array.isArray(value) ? value : value ? [value] : [];
      if (key !== "view" && key !== "page") for (const item of items) exportParams.append(key, item);
    }
    if (event) exportParams.set("eventId", event.id);
    const exportHref = hasPermissionOrFallback(permissions, "booking:export") ? `/admin/attendees/export?${exportParams.toString()}` : undefined;
    const filters = activeFilterCount(query);

    return (
      <>
        {title}
        <KpiGrid cols={3}>
          <KpiTile label="Guests" value={result.total} hint={filters > 0 || query.search ? "matching the filters" : "with a ticket"} icon={<Users />} />
          <KpiTile label="Checked in" value={result.checkedIn} hint={result.total > 0 ? `${Math.round((result.checkedIn / result.total) * 100)}% of them` : "—"} tone="success" icon={<UserCheck />} />
          <KpiTile label="Still expected" value={Math.max(result.total - result.checkedIn, 0)} hint="not scanned yet" tone="info" icon={<ScanLine />} className="col-span-2 md:col-span-1" />
        </KpiGrid>
        <AttendeeBreakdowns breakdowns={result.breakdowns} basePath={basePath} params={params} />
        <AttendeesTable rows={rows} columns={columns} query={query} total={result.total} basePath={basePath} prefs={prefs} exportHref={exportHref} toolbarLeading={viewTabs} />
      </>
    );
  }

  const prefs = await readTablePrefs("bookings");
  const listOptions: ListOptions = {
    eventPreset: Boolean(event),
    groups: options.groups,
    events: eventOptions,
    tags: options.tags,
    fields: options.guestFields.map((field) => ({ ...field, type: "text", choices: [] })),
  };
  const columns = bookingColumns(listOptions);
  const { query, filter, sortBy, sortDir } = bookingQueryFromParams(params, columns as never, prefs?.pageSize, event?.id);
  const result = await listBookingsForOrg(organizationId, { ...filter, page: query.page, pageSize: query.pageSize, sortBy, sortDir });
  const guestSummaries = await summarizeBookingGuests(result.bookings.map((booking) => String(booking._id)));

  const rows: BookingRow[] = result.bookings.map((booking) => {
    const summary = guestSummaries.get(String(booking._id));
    const out: BookingRow = {
      id: String(booking._id),
      createdAt: new Date(booking.createdAt).toISOString(),
      customerName: booking.customer?.name ?? "",
      customerEmail: booking.customer?.email ?? "",
      eventName: booking.eventName ?? "",
      groupName: booking.groupName ?? "",
      hotelName: booking.hotelName ?? "",
      total: booking.totalHuf,
      currency: booking.currency ?? "HUF",
      guests: booking.guests,
      checkedIn: summary ? summary.checkedIn : null,
      status: booking.status,
      source: booking.source ?? "",
      isTest: Boolean(booking.isTest),
      tags: summary?.tags ?? [],
      paidVia: booking.paymentMethod ?? "stripe",
      invoiceStatus: booking.invoiceStatus ?? "",
      invoiceSource: booking.invoiceSource ?? "",
    };
    for (const field of options.guestFields) {
      out[ANSWER_PREFIX + field.key] = (booking.attendees ?? [])
        .map((attendee) => attendee.fields?.[field.key])
        .filter((value) => value !== undefined && value !== null && String(value) !== "")
        .map(String)
        .join(", ");
    }
    return out;
  });

  const exportQuery = new URLSearchParams();
  if (filter.status) exportQuery.set("status", filter.status.join(","));
  if (filter.invoiceStatus) exportQuery.set("invoiceStatus", filter.invoiceStatus.join(","));
  if (filter.eventId) exportQuery.set("eventId", filter.eventId);
  if (filter.groupId) exportQuery.set("groupId", filter.groupId);
  if (filter.search) exportQuery.set("search", filter.search);
  if (filter.createdFrom) exportQuery.set("createdFrom", filter.createdFrom.toISOString());
  if (filter.createdTo) exportQuery.set("createdTo", filter.createdTo.toISOString());
  const exportHref = hasPermissionOrFallback(permissions, "booking:export") ? `/api/v2/admin/bookings/export?${exportQuery.toString()}` : undefined;
  const filters = activeFilterCount(query);

  return (
    <>
      {title}
      <KpiGrid cols={3}>
        <KpiTile label="Matching" value={result.total} hint={filters > 0 || query.search ? "matching the filters" : event ? "all bookings of this event" : "all bookings"} icon={<CreditCard />} />
        <KpiTile label="Guests" value={result.paidGuests} hint="paid + confirmed" tone="info" icon={<Ticket />} />
        <KpiTile label="Revenue" value={formatRevenue(result.revenueByCurrency)} hint="paid + confirmed" tone="success" icon={<Wallet />} className="col-span-2 md:col-span-1" />
      </KpiGrid>
      <BookingsTable rows={rows} columns={columns} query={query} total={result.total} basePath={basePath} prefs={prefs} exportHref={exportHref} toolbarLeading={viewTabs} />
    </>
  );
}
