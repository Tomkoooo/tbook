import { bookingStatuses, invoiceStatuses } from "@tbook/schemas";
import type { ColumnDef } from "@/components/data-table";

/**
 * Column definitions of the bookings list and the attendees list. Serializable
 * on purpose (no render functions): the server page reads them to know what
 * the URL may sort and filter by, and the client tables add the cell renderers.
 */

export interface BookingRow extends Record<string, unknown> {
  id: string;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  eventName: string;
  groupName: string;
  hotelName: string;
  total: number;
  currency: string;
  guests: number;
  checkedIn: number | null;
  status: string;
  source: string;
  isTest: boolean;
  tags: string[];
  paidVia: string;
  invoiceStatus: string;
  invoiceSource: string;
}

export interface AttendeeTableRow extends Record<string, unknown> {
  id: string;
  bookingId: string;
  eventId: string;
  eventName: string;
  name: string;
  registrationNumber: string;
  status: string;
  checkedInAt: string | null;
  tags: string[];
  buyer: string;
}

export interface ListOptions {
  /** On an event's page the event (and group) filters are fixed by the path. */
  eventPreset: boolean;
  groups: Array<{ id: string; name: string }>;
  events: Array<{ id: string; name: string }>;
  tags: string[];
  fields: Array<{ key: string; label: string; type: string; identifier: boolean; choices: Array<{ value: string; label: string }> }>;
}

const opts = (items: Array<{ id: string; name: string }>) => items.map((item) => ({ value: item.id, label: item.name }));

/** Prefix of an answer column: the guest's answer to question `key` is column `a_<key>`. */
export const ANSWER_PREFIX = "a_";

export const BOOKING_SORT_KEYS: Record<string, "createdAt" | "customerName" | "eventName" | "totalHuf"> = {
  createdAt: "createdAt",
  customerName: "customerName",
  eventName: "eventName",
  total: "totalHuf",
};

export function bookingColumns(options: ListOptions): ColumnDef<BookingRow>[] {
  const answerColumns: ColumnDef<BookingRow>[] = options.fields.map((field) => ({
    key: ANSWER_PREFIX + field.key,
    label: field.label,
    defaultVisible: field.identifier,
    className: "max-w-56 truncate",
  }));
  return [
    { key: "createdAt", label: "Booked", type: "date", sortable: true, filterable: true, className: "text-muted-foreground whitespace-nowrap" },
    { key: "customerName", label: "Customer", sortable: true, searchable: true, hideable: false },
    ...(options.eventPreset
      ? []
      : ([
          { key: "eventName", label: "Event", type: "enum", sortable: true, filterable: true, enumValues: opts(options.events), className: "min-w-40 whitespace-normal" },
          { key: "groupName", label: "Group", type: "enum", filterable: true, enumValues: opts(options.groups), defaultVisible: false },
        ] satisfies ColumnDef<BookingRow>[])),
    { key: "total", label: "Total", type: "number", sortable: true, align: "right" },
    ...answerColumns,
    { key: "guests", label: "Guests", align: "right", type: "enum", filterable: true, columnPickerLabel: "Guests / check-in", enumValues: [{ value: "in", label: "Someone checked in" }, { value: "not_in", label: "Nobody checked in yet" }] },
    {
      key: "status",
      label: "Status",
      type: "enum",
      filterable: true,
      enumValues: bookingStatuses.map((status) => ({ value: status, label: status })),
    },
    { key: "tags", label: "Guest tags", type: "string", filterVariant: "select", filterable: true, enumValues: options.tags.map((tag) => ({ value: tag, label: tag })) },
    { key: "paidVia", label: "Paid via", className: "text-muted-foreground", defaultVisible: false },
    { key: "invoiceStatus", label: "Invoice", type: "enum", filterable: true, enumValues: invoiceStatuses.map((status) => ({ value: status, label: status })) },
    { key: "open", label: "", columnPickerLabel: "Open", align: "right", hideable: false, exportable: false },
  ];
}

export const ATTENDEE_STATUS = [
  { value: "active", label: "Expected" },
  { value: "checked_in", label: "Checked in" },
];

export function attendeeColumns(options: ListOptions): ColumnDef<AttendeeTableRow>[] {
  // The identifying answer (employee ID…) and the first handful of questions show by default; the rest are one click away in Columns.
  const answerColumns: ColumnDef<AttendeeTableRow>[] = options.fields.map((field, index) => {
    const choice = field.type === "select" || field.type === "checkbox";
    return {
      key: ANSWER_PREFIX + field.key,
      label: field.label,
      sortable: true,
      filterable: choice,
      type: choice ? "enum" : "string",
      enumValues: field.type === "checkbox" ? [{ value: "yes", label: "Igen" }, { value: "no", label: "Nem" }] : choice ? field.choices : undefined,
      defaultVisible: field.identifier || index < 6,
    };
  });
  return [
    { key: "name", label: "Guest", sortable: true, searchable: true, hideable: false },
    { key: "registrationNumber", label: "Reg. no.", sortable: true, className: "tabular-nums", defaultVisible: true },
    ...(options.eventPreset ? [] : ([{ key: "eventName", label: "Event", type: "enum", sortable: true, filterable: true, enumValues: opts(options.events), className: "min-w-40 whitespace-normal" }] satisfies ColumnDef<AttendeeTableRow>[])),
    ...answerColumns,
    { key: "status", label: "Door", type: "enum", sortable: true, filterable: true, enumValues: ATTENDEE_STATUS, badgeTones: { active: "neutral", checked_in: "success" } },
    { key: "tags", label: "Tags", type: "string", filterVariant: "select", filterable: true, enumValues: options.tags.map((tag) => ({ value: tag, label: tag })) },
    { key: "buyer", label: "Booked by", className: "text-muted-foreground", defaultVisible: false },
    { key: "open", label: "", columnPickerLabel: "Open booking", align: "right", hideable: false, exportable: false },
  ];
}
