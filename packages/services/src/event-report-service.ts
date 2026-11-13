import ExcelJS from "exceljs";
import { BookingModel, VoucherModel, type IBooking } from "@tbook/db";
import { isCheckboxChecked } from "@tbook/domain";
import type { AttendeeFieldDef, AttendeeFieldValue, BookingAttendee } from "@tbook/schemas";
import { getEventForOrg } from "./catalog-admin-service";
import { liveFieldSchemaForEvent } from "./registration-changes";
import { resolveAttendeeDisplayName } from "./voucher-service";

/**
 * One event's registrations in numbers: headline counts, how the answers
 * split (every select / checkbox question), registrations per day, and a
 * spreadsheet of every guest.
 */

const ACTIVE = ["paid", "confirmed"] as const;
const TIME_ZONE = "Europe/Budapest";
const dayKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);

export interface ReportFilter {
  /** Only guests with this answer, e.g. { fieldKey: "munkaltato", value: "DHEL" }. */
  fieldKey?: string;
  value?: string;
}

interface GuestRow {
  booking: IBooking;
  attendee: BookingAttendee;
  index: number;
  name: string;
  checkedInAt: Date | null;
  tags: string[];
}

function plain<T>(value: T): T {
  return typeof (value as { toObject?: () => T }).toObject === "function" ? (value as unknown as { toObject: () => T }).toObject() : value;
}

async function loadGuests(eventId: string, schema: AttendeeFieldDef[], filter: ReportFilter): Promise<GuestRow[]> {
  // Test bookings (v1 X-TBook-Test) are never part of a report.
  const bookings = await BookingModel.find({ eventId, status: { $in: [...ACTIVE] }, isTest: { $ne: true } }).sort({ createdAt: 1 }).exec();
  const vouchers = await VoucherModel.find({ eventId, attendeeIndex: { $gte: 0 } }, { bookingId: 1, attendeeIndex: 1, checkedInAt: 1, status: 1 }).lean().exec();
  const checkIns = new Map(vouchers.map((v) => [`${String(v.bookingId)}:${v.attendeeIndex}`, v.status === "checked_in" ? (v.checkedInAt ?? null) : null]));
  const rows: GuestRow[] = [];
  for (const booking of bookings) {
    const attendees = (booking.attendees ?? []).map((a) => plain(a) as BookingAttendee);
    const count = Math.max(booking.guests, attendees.length);
    for (let index = 0; index < count; index += 1) {
      const attendee = attendees[index] ?? { fields: {} };
      if (filter.fieldKey && filter.value != null && filter.value !== "" && answerKey(schema.find((f) => f.key === filter.fieldKey), attendee.fields?.[filter.fieldKey]) !== filter.value) continue;
      rows.push({
        booking,
        attendee,
        index,
        name: resolveAttendeeDisplayName(index, attendees, (booking.attendeeFieldSchema ?? []) as AttendeeFieldDef[], booking.customer?.name ?? "", booking.guests),
        checkedInAt: checkIns.get(`${String(booking._id)}:${index}`) ?? null,
        tags: attendee.tags ?? [],
      });
    }
  }
  return rows;
}

function answerKey(field: AttendeeFieldDef | undefined, raw: AttendeeFieldValue | undefined): string {
  if (field?.type === "checkbox") return isCheckboxChecked(raw) ? "yes" : "no";
  return raw == null ? "" : String(raw);
}

function answerLabel(field: AttendeeFieldDef | undefined, raw: AttendeeFieldValue | undefined): string {
  if (field?.type === "checkbox") return isCheckboxChecked(raw) ? "Igen" : "Nem";
  if (raw == null || raw === "") return "";
  if (field?.type === "select") return field.choices?.find((c) => c.value === String(raw))?.label ?? String(raw);
  return String(raw);
}

export interface EventReport {
  eventName: string;
  capacity: number | null;
  registrations: number;
  guests: number;
  checkedIn: number;
  cancelledGuests: number;
  cancelledBookings: number;
  tagCounts: Array<{ tag: string; count: number }>;
  breakdowns: Array<{ fieldKey: string; label: string; rows: Array<{ value: string; label: string; count: number }> }>;
  perDay: Array<{ day: string; guests: number; cumulative: number }>;
  filterFields: Array<{ key: string; label: string; options: Array<{ value: string; label: string }> }>;
}

export async function eventReport(organizationId: string, eventId: string, filter: ReportFilter = {}): Promise<EventReport> {
  const event = await getEventForOrg(organizationId, eventId);
  const schema = await liveFieldSchemaForEvent(eventId, (event.attendeeFieldSchema ?? []).map((f) => plain(f) as AttendeeFieldDef));
  const guests = await loadGuests(eventId, schema, filter);
  const groupable = schema.filter((field) => field.type === "select" || field.type === "checkbox");

  const breakdowns = groupable.map((field) => {
    const counts = new Map<string, { label: string; count: number }>();
    if (field.type === "select") for (const choice of field.choices ?? []) counts.set(choice.value, { label: choice.label.replace(/ \(full\)$/, ""), count: 0 });
    for (const row of guests) {
      const raw = row.attendee.fields?.[field.key];
      const key = answerKey(field, raw);
      const entry = counts.get(key) ?? { label: answerLabel(field, raw) || "—", count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    return { fieldKey: field.key, label: field.label, rows: [...counts.entries()].map(([value, v]) => ({ value, label: v.label, count: v.count })) };
  });

  const perDayMap = new Map<string, number>();
  const seenBookings = new Set<string>();
  for (const row of guests) {
    const day = dayKey(row.booking.createdAt);
    perDayMap.set(day, (perDayMap.get(day) ?? 0) + 1);
    seenBookings.add(String(row.booking._id));
  }
  let cumulative = 0;
  const perDay = [...perDayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, guests: count, cumulative: (cumulative += count) }));

  const tagMap = new Map<string, number>();
  for (const row of guests) for (const tag of row.tags) tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);

  const cancelled = await BookingModel.aggregate<{ guests: number; bookings: number }>([
    { $match: { eventId: event._id, isTest: { $ne: true } } },
    {
      $group: {
        _id: null,
        guests: { $sum: { $add: [{ $size: { $ifNull: ["$cancelledAttendees", []] } }, { $cond: [{ $eq: ["$status", "cancelled"] }, "$guests", 0] }] } },
        bookings: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
      },
    },
  ]).exec();

  return {
    eventName: event.name,
    capacity: event.capacity ?? null,
    registrations: seenBookings.size,
    guests: guests.length,
    checkedIn: guests.filter((row) => row.checkedInAt).length,
    cancelledGuests: cancelled[0]?.guests ?? 0,
    cancelledBookings: cancelled[0]?.bookings ?? 0,
    tagCounts: [...tagMap.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
    breakdowns,
    perDay,
    filterFields: breakdowns.map((b) => ({ key: b.fieldKey, label: b.label, options: b.rows.map((r) => ({ value: r.value, label: r.label })) })),
  };
}

/** Every guest with every answer, registration number, check-in and tags. Cancelled guests on a second sheet. */
export async function exportEventRegistrationsXlsx(organizationId: string, eventId: string, filter: ReportFilter = {}): Promise<{ fileName: string; buffer: Buffer }> {
  const event = await getEventForOrg(organizationId, eventId);
  const schema = await liveFieldSchemaForEvent(eventId, (event.attendeeFieldSchema ?? []).map((f) => plain(f) as AttendeeFieldDef));
  const guests = await loadGuests(eventId, schema, filter);
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet("Regisztrációk");
  sheet.columns = [
    { header: "Regisztrációs szám", key: "rn", width: 14 },
    { header: "Név", key: "name", width: 26 },
    ...schema.map((field) => ({ header: field.label, key: `f:${field.key}`, width: field.type === "textarea" ? 40 : 18 })),
    { header: "Címkék", key: "tags", width: 16 },
    { header: "Belépett", key: "checkedIn", width: 18 },
    { header: "Regisztrált", key: "createdAt", width: 18 },
    { header: "Csoportos regisztráció (kapcsolattartó)", key: "contact", width: 28 },
    { header: "Kapcsolattartó e-mail", key: "contactEmail", width: 28 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of guests) {
    const values: Record<string, unknown> = {
      rn: row.attendee.registrationNumber ?? "",
      name: row.name,
      tags: row.tags.join(", "),
      checkedIn: row.checkedInAt ?? "",
      createdAt: row.booking.createdAt,
      contact: row.booking.guests > 1 ? row.booking.customer?.name ?? "" : "",
      contactEmail: row.booking.customer?.email ?? "",
    };
    for (const field of schema) values[`f:${field.key}`] = answerLabel(field, row.attendee.fields?.[field.key]);
    sheet.addRow(values);
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  const cancelledSheet = workbook.addWorksheet("Lemondott");
  cancelledSheet.columns = [
    { header: "Regisztrációs szám", key: "rn", width: 14 },
    ...schema.map((field) => ({ header: field.label, key: `f:${field.key}`, width: 18 })),
    { header: "Lemondva", key: "at", width: 18 },
    { header: "Ki mondta le", key: "by", width: 14 },
    { header: "Indok", key: "reason", width: 30 },
  ];
  cancelledSheet.getRow(1).font = { bold: true };
  const withCancellations = await BookingModel.find({ eventId, isTest: { $ne: true }, $or: [{ status: "cancelled" }, { "cancelledAttendees.0": { $exists: true } }] }).exec();
  for (const booking of withCancellations) {
    const entries =
      booking.status === "cancelled" && (booking.cancelledAttendees ?? []).length === 0
        ? (booking.attendees ?? []).map((attendee) => ({ attendee: plain(attendee) as BookingAttendee, cancelledAt: booking.updatedAt, cancelledBy: "admin", reason: "" }))
        : (booking.cancelledAttendees ?? []).map((entry) => plain(entry));
    for (const entry of entries) {
      const values: Record<string, unknown> = {
        rn: entry.attendee.registrationNumber ?? "",
        at: entry.cancelledAt,
        by: entry.cancelledBy === "guest" ? "Vendég" : entry.cancelledBy.startsWith("admin") ? "Szervező" : "Rendszer",
        reason: entry.reason,
      };
      for (const field of schema) values[`f:${field.key}`] = answerLabel(field, entry.attendee.fields?.[field.key]);
      cancelledSheet.addRow(values);
    }
  }

  const safe = event.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "event";
  return { fileName: `${safe} - regisztraciok.xlsx`, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}
