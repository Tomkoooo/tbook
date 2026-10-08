import Link from "next/link";
import { bookingStatuses, invoiceStatuses } from "@tbook/schemas";
import { Field, Input, Select } from "@tbook/ui";

/**
 * Plain GET form — no client JS. Submitting navigates to the same page
 * with the filters in the query string, which is exactly the state the
 * server component reads, so there is one source of truth for "what is
 * being shown" and the browser's back button works correctly.
 */
export function BookingFilters({
  options,
  params,
}: {
  options: {
    groups: Array<{ id: string; name: string }>;
    events: Array<{ id: string; name: string; groupId: string | null }>;
  };
  params: Record<string, string | string[] | undefined>;
}) {
  const value = (key: string): string => {
    const raw = params[key];
    const single = Array.isArray(raw) ? raw[0] : raw;
    return single ?? "";
  };

  return (
    <form method="get" action="/admin/bookings" className="tbook-filter-form">
      <Field label="Search" htmlFor="search" hint="Name, email, phone or event">
        <Input id="search" name="search" defaultValue={value("search")} placeholder="Kovács, bela@…, +3630…" />
      </Field>

      <Field label="Status" htmlFor="status">
        <Select
          id="status"
          name="status"
          defaultValue={value("status")}
          placeholder="Any status"
          options={bookingStatuses.map((status) => ({ value: status, label: status }))}
        />
      </Field>

      <Field label="Invoice" htmlFor="invoiceStatus">
        <Select
          id="invoiceStatus"
          name="invoiceStatus"
          defaultValue={value("invoiceStatus")}
          placeholder="Any invoice state"
          options={invoiceStatuses.map((status) => ({ value: status, label: status }))}
        />
      </Field>

      <Field label="Group" htmlFor="groupId">
        <Select
          id="groupId"
          name="groupId"
          defaultValue={value("groupId")}
          placeholder="All groups"
          options={options.groups.map((group) => ({ value: group.id, label: group.name }))}
        />
      </Field>

      <Field label="Event" htmlFor="eventId">
        <Select
          id="eventId"
          name="eventId"
          defaultValue={value("eventId")}
          placeholder="All events"
          options={options.events.map((event) => ({ value: event.id, label: event.name }))}
        />
      </Field>

      <Field label="Booked from" htmlFor="createdFrom">
        <Input id="createdFrom" name="createdFrom" type="date" defaultValue={value("createdFrom")} />
      </Field>

      <Field label="Booked to" htmlFor="createdTo">
        <Input id="createdTo" name="createdTo" type="date" defaultValue={value("createdTo")} />
      </Field>

      <div className="tbook-filter-actions">
        <button type="submit" className="tbook-btn tbook-btn-primary">
          Apply
        </button>
        <Link href="/admin/bookings" className="tbook-btn tbook-btn-ghost">
          Clear
        </Link>
      </div>
    </form>
  );
}
