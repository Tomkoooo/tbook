import { BookingModel, VoucherModel, eventGroupRepository, eventRepository } from "@tbook/db";
import { isCheckboxChecked } from "@tbook/domain";
import type { AttendeeFieldDef } from "@tbook/schemas";
import { ActionError } from "@tbook/actions";

/**
 * The people behind the bookings: one row per guest who holds a ticket
 * (a voucher), with the answers they gave at registration as their own
 * columns, check-in state and tags — and, for the filtered set, how the
 * answers split (every choice question). The bookings list is one row per
 * *purchase*; this is the list the door, the caterer and the bus plan use.
 */

export interface AttendeeFieldOption {
  key: string;
  label: string;
  type: AttendeeFieldDef["type"];
  identifier: boolean;
  choices: Array<{ value: string; label: string }>;
}

export interface AttendeeListQuery {
  eventId?: string;
  search?: string;
  /** "active" = expected, "checked_in". */
  status?: string[];
  tags?: string[];
  /** `{ fieldKey: [values] }`; for a checkbox question the values are "yes" / "no". */
  answers?: Record<string, string[]>;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /** `false` skips the per-question split (an export doesn't need it). */
  withBreakdown?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AttendeeRow {
  id: string;
  bookingId: string;
  eventId: string;
  eventName: string;
  name: string;
  registrationNumber: string;
  status: "active" | "checked_in";
  checkedInAt: string | null;
  tags: string[];
  buyer: string;
  answers: Record<string, string>;
}

export interface AttendeeBreakdown {
  fieldKey: string;
  label: string;
  total: number;
  rows: Array<{ value: string; label: string; count: number }>;
}

export interface AttendeeListResult {
  rows: AttendeeRow[];
  total: number;
  checkedIn: number;
  breakdowns: AttendeeBreakdown[];
  fields: AttendeeFieldOption[];
  events: Array<{ id: string; name: string }>;
  tags: string[];
}

const MAX_PAGE_SIZE = 250;
const BREAKDOWN_SCAN_LIMIT = 20000;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function orgEvents(organizationId: string) {
  const groups = await eventGroupRepository.findByOrganizationId(organizationId);
  const perGroup = await Promise.all(groups.map((group) => eventRepository.findByGroupId(String(group._id))));
  return perGroup.flat();
}

/** The answer a checkbox question stores, as "yes" / "no" — so "yes" survives true / "on" / "Igen" alike. */
const checkboxKey = (raw: unknown) => (isCheckboxChecked(raw as never) ? "yes" : "no");
const YES_VALUES = [true, "true", "1", "on", "Igen", "x"];

/** Guests with a ticket in the organization (or in one event), filtered, sorted, paged. Another organization's event is a 404. */
export async function listAttendeesForOrg(organizationId: string, query: AttendeeListQuery = {}): Promise<AttendeeListResult> {
  const events = await orgEvents(organizationId);
  if (query.eventId && !events.some((event) => String(event._id) === query.eventId)) throw ActionError.notFound("Event not found");
  const scoped = query.eventId ? events.filter((event) => String(event._id) === query.eventId) : events;
  const eventIds = scoped.map((event) => String(event._id));

  const fieldMap = new Map<string, AttendeeFieldOption>();
  for (const event of scoped) {
    for (const field of event.attendeeFieldSchema ?? []) {
      const known = fieldMap.get(field.key);
      fieldMap.set(field.key, {
        key: field.key,
        label: known?.label || field.label || field.key,
        type: known?.type ?? field.type,
        identifier: Boolean(known?.identifier || field.identifier || field.unique),
        choices: known?.choices.length ? known.choices : (field.choices ?? []).map((choice) => ({ value: choice.value, label: choice.label })),
      });
    }
  }
  const fields = [...fieldMap.values()];
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));

  const and: Array<Record<string, unknown>> = [{ eventId: { $in: eventIds } }, { status: query.status?.length ? { $in: query.status.filter((status) => status === "active" || status === "checked_in") } : { $ne: "void" } }, { attendeeIndex: { $gte: 0 } }];
  if (query.tags?.length) and.push({ tags: { $in: query.tags } });
  for (const [key, values] of Object.entries(query.answers ?? {})) {
    if (!fieldByKey.has(key) || values.length === 0) continue;
    const path = `attendeeFields.${key}`;
    if (fieldByKey.get(key)!.type === "checkbox") {
      const wantsYes = values.includes("yes");
      const wantsNo = values.includes("no");
      if (wantsYes && !wantsNo) and.push({ [path]: { $in: YES_VALUES } });
      if (wantsNo && !wantsYes) and.push({ [path]: { $nin: YES_VALUES } });
    } else {
      and.push({ [path]: { $in: values } });
    }
  }
  const needle = query.search?.trim();
  if (needle) {
    const pattern = new RegExp(escapeRegex(needle), "i");
    and.push({ $or: [{ displayName: pattern }, { registrationNumber: pattern }, ...fields.filter((field) => field.type !== "checkbox").map((field) => ({ [`attendeeFields.${field.key}`]: pattern }))] });
  }
  const filter = { $and: and };

  const sortKey = query.sortBy?.startsWith("answer:") && fieldByKey.has(query.sortBy.slice(7)) ? `attendeeFields.${query.sortBy.slice(7)}` : ({ name: "displayName", registrationNumber: "registrationNumber", status: "checkedInAt", event: "eventSnapshot.name" } as Record<string, string>)[query.sortBy ?? ""] ?? "createdAt";
  const direction = query.sortDir === "asc" ? 1 : -1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), MAX_PAGE_SIZE);
  const page = Math.max(query.page ?? 1, 1);

  const [vouchers, total, checkedIn, scan, allTags] = await Promise.all([
    VoucherModel.find(filter)
      .sort({ [sortKey]: direction, _id: 1 })
      .collation({ locale: "hu", numericOrdering: true })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean()
      .exec(),
    VoucherModel.countDocuments(filter).exec(),
    VoucherModel.countDocuments({ $and: [...and, { status: "checked_in" }] }).exec(),
    query.withBreakdown === false ? Promise.resolve([]) : VoucherModel.find(filter, { attendeeFields: 1 }).limit(BREAKDOWN_SCAN_LIMIT).lean().exec(),
    VoucherModel.distinct("tags", { eventId: { $in: eventIds } }).exec() as Promise<string[]>,
  ]);

  const bookings = await BookingModel.find({ _id: { $in: [...new Set(vouchers.map((voucher) => String(voucher.bookingId)))] } }, { customer: 1 }).lean().exec();
  const buyerOf = new Map(bookings.map((booking) => [String(booking._id), booking.customer?.name ?? ""]));

  const answerText = (field: AttendeeFieldOption | undefined, raw: unknown): string => {
    if (raw === null || raw === undefined || raw === "") return "";
    if (field?.type === "checkbox") return checkboxKey(raw) === "yes" ? "Igen" : "Nem";
    const text = String(raw);
    return field?.choices.find((choice) => choice.value === text)?.label ?? text;
  };

  const rows: AttendeeRow[] = vouchers.map((voucher) => {
    const stored = (voucher.attendeeFields ?? {}) as Record<string, unknown>;
    const answers: Record<string, string> = {};
    for (const field of fields) answers[field.key] = answerText(field, stored[field.key]);
    return {
      id: String(voucher._id),
      bookingId: String(voucher.bookingId),
      eventId: String(voucher.eventId),
      eventName: voucher.eventSnapshot?.name ?? "",
      name: voucher.displayName,
      registrationNumber: voucher.registrationNumber ?? "",
      status: voucher.status === "checked_in" ? "checked_in" : "active",
      checkedInAt: voucher.checkedInAt ? new Date(voucher.checkedInAt).toISOString() : null,
      tags: voucher.tags ?? [],
      buyer: buyerOf.get(String(voucher.bookingId)) ?? "",
      answers,
    };
  });

  // How the filtered guests answered each choice question, most common first.
  const breakdowns: AttendeeBreakdown[] = [];
  for (const field of fields.filter((candidate) => candidate.type === "select" || candidate.type === "checkbox")) {
    const counts = new Map<string, number>();
    for (const voucher of scan) {
      const raw = ((voucher.attendeeFields ?? {}) as Record<string, unknown>)[field.key];
      const value = field.type === "checkbox" ? checkboxKey(raw) : raw === null || raw === undefined ? "" : String(raw);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const answered = [...counts.entries()].filter(([value]) => value !== "");
    if (answered.length === 0) continue;
    breakdowns.push({
      fieldKey: field.key,
      label: field.label,
      total: scan.length,
      rows: [...counts.entries()]
        .map(([value, count]) => ({
          value,
          label: value === "" ? "No answer" : field.type === "checkbox" ? (value === "yes" ? "Igen" : "Nem") : (field.choices.find((choice) => choice.value === value)?.label ?? value),
          count,
        }))
        .sort((a, b) => b.count - a.count),
    });
  }

  return {
    rows,
    total,
    checkedIn,
    breakdowns,
    fields,
    events: scoped.map((event) => ({ id: String(event._id), name: event.name })),
    tags: allTags.filter(Boolean).sort((a, b) => a.localeCompare(b, "hu")),
  };
}
