import Link from "next/link";
import { bookingStatuses, invoiceStatuses } from "@tbook/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, NativeSelect } from "@/components/form-bits";

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
    <form method="get" action="/admin/bookings" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <FormField label="Search" htmlFor="search" hint="Name, email, phone or event" className="sm:col-span-2">
        <Input id="search" name="search" defaultValue={value("search")} placeholder="Kovács, bela@…, +3630…" />
      </FormField>

      <FilterSelect id="status" label="Status" placeholder="Any status" defaultValue={value("status")}
        options={bookingStatuses.map((status) => ({ value: status, label: status }))} />
      <FilterSelect id="invoiceStatus" label="Invoice" placeholder="Any invoice state" defaultValue={value("invoiceStatus")}
        options={invoiceStatuses.map((status) => ({ value: status, label: status }))} />
      <FilterSelect id="groupId" label="Group" placeholder="All groups" defaultValue={value("groupId")}
        options={options.groups.map((group) => ({ value: group.id, label: group.name }))} />
      <FilterSelect id="eventId" label="Event" placeholder="All events" defaultValue={value("eventId")}
        options={options.events.map((event) => ({ value: event.id, label: event.name }))} />

      <FormField label="Booked from" htmlFor="createdFrom">
        <Input id="createdFrom" name="createdFrom" type="date" defaultValue={value("createdFrom")} />
      </FormField>
      <FormField label="Booked to" htmlFor="createdTo">
        <Input id="createdTo" name="createdTo" type="date" defaultValue={value("createdTo")} />
      </FormField>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit">Apply filters</Button>
        <Button variant="ghost" asChild>
          <Link href="/admin/bookings">Clear</Link>
        </Button>
      </div>
    </form>
  );
}

function FilterSelect({
  id,
  label,
  placeholder,
  defaultValue,
  options,
}: {
  id: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <FormField label={label} htmlFor={id}>
      <NativeSelect id={id} name={id} defaultValue={defaultValue}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  );
}
