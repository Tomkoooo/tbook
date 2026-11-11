import { ActionError } from "@tbook/actions";
import { BookingModel, GuestTagRuleModel, VoucherModel, type IBooking } from "@tbook/db";
import { normalizeUniqueValue } from "@tbook/domain";
import type { BookingAttendee } from "@tbook/schemas";
import { extensions } from "./extensions";
import { registerImportTarget } from "./spreadsheet-import";

/**
 * Guest tags ("VIP", "Sajtó", "Díjazott", …): labels on one attendee,
 * copied to their ticket so the door sees them and the roster can be
 * filtered by them. Set by hand on a booking, or in bulk from a
 * spreadsheet matched on a registration answer (e.g. employee ID).
 */

export function cleanTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 20);
}

function parseTagCell(raw: string): string[] {
  return cleanTags(raw.split(/[,;|]/));
}

async function writeTags(booking: IBooking, attendeeIndex: number, tags: string[], by: string): Promise<void> {
  const attendee = booking.attendees?.[attendeeIndex] as BookingAttendee | undefined;
  if (!attendee) throw ActionError.notFound("Guest not found");
  const before = (attendee.tags ?? []).join(", ");
  const after = tags.join(", ");
  if (before === after) return;
  await BookingModel.updateOne(
    { _id: booking._id },
    {
      $set: { [`attendees.${attendeeIndex}.tags`]: tags },
      $push: {
        changeLog: { at: new Date(), by, action: "edited", attendeeId: attendee.id ?? null, registrationNumber: attendee.registrationNumber ?? null, changes: [{ field: "Tags", before, after }] },
      },
    },
  ).exec();
  await VoucherModel.updateMany({ bookingId: booking._id, attendeeIndex }, { $set: { tags } }).exec();
}

export async function setAttendeeTags(organizationId: string, bookingId: string, attendeeIndex: number, tags: string[], by: string): Promise<void> {
  const booking = await BookingModel.findById(bookingId).exec();
  if (!booking || String(booking.organizationId) !== organizationId) throw ActionError.notFound("Booking not found");
  await writeTags(booking, attendeeIndex, cleanTags(tags), by);
}

/** Every tag used on an event's tickets, for the check-in filter. */
export async function listEventTags(eventId: string): Promise<string[]> {
  const tags = (await VoucherModel.distinct("tags", { eventId }).exec()) as string[];
  return tags.filter(Boolean).sort((a, b) => a.localeCompare(b, "hu"));
}

function identifierValues(booking: IBooking, attendee: BookingAttendee): string[] {
  const schema = booking.attendeeFieldSchema ?? [];
  const keys = schema.filter((field) => field.identifier || field.unique).map((field) => field.key);
  return keys.map((key) => normalizeUniqueValue(attendee.fields?.[key])).filter(Boolean);
}

/** Applies tags imported before these guests registered (booking-confirmed hook). */
export async function applyPendingGuestTags(booking: IBooking): Promise<void> {
  const attendees = (booking.attendees ?? []) as BookingAttendee[];
  for (const [attendeeIndex, attendee] of attendees.entries()) {
    const values = identifierValues(booking, attendee);
    if (values.length === 0) continue;
    const rules = await GuestTagRuleModel.find({ eventId: booking.eventId, value: { $in: values } }).exec();
    if (rules.length === 0) continue;
    const fresh = (await BookingModel.findById(booking._id).exec())!;
    const current = (fresh.attendees?.[attendeeIndex] as BookingAttendee | undefined)?.tags ?? [];
    await writeTags(fresh, attendeeIndex, cleanTags([...current, ...rules.flatMap((rule) => rule.tags)]), "system:tag-list");
  }
}

extensions.onBookingConfirmed("core:guest-tags", applyPendingGuestTags);

registerImportTarget({
  key: "core:guest-tags",
  label: "Guest tags (VIP, …)",
  description:
    "Tags guests by their identifying answer (e.g. employee ID). Registered guests are tagged now; anyone on the sheet who registers later gets the tags then.",
  moduleKey: null,
  needsEvent: true,
  fields: [
    { key: "match", label: "Identifying answer (e.g. employee ID)", required: true },
    { key: "tags", label: "Tags (comma-separated)", required: true },
  ],
  async apply(ctx, rows) {
    const bookings = await BookingModel.find({ eventId: ctx.eventId, status: { $in: ["paid", "confirmed"] } }).exec();
    const index = new Map<string, Array<{ bookingId: string; attendeeIndex: number }>>();
    for (const booking of bookings) {
      ((booking.attendees ?? []) as BookingAttendee[]).forEach((attendee, attendeeIndex) => {
        for (const value of identifierValues(booking, attendee)) index.set(value, [...(index.get(value) ?? []), { bookingId: String(booking._id), attendeeIndex }]);
      });
    }
    let updated = 0;
    let pending = 0;
    let skipped = 0;
    for (const row of rows) {
      const value = normalizeUniqueValue(row.match);
      const tags = parseTagCell(row.tags ?? "");
      if (!value || tags.length === 0) {
        skipped += 1;
        continue;
      }
      const existingRule = await GuestTagRuleModel.findOne({ eventId: ctx.eventId, value }).exec();
      await GuestTagRuleModel.updateOne(
        { eventId: ctx.eventId, value },
        { $set: { organizationId: ctx.organizationId, tags: cleanTags([...(existingRule?.tags ?? []), ...tags]) } },
        { upsert: true },
      ).exec();
      const hits = index.get(value) ?? [];
      if (hits.length === 0) pending += 1;
      for (const hit of hits) {
        const fresh = (await BookingModel.findById(hit.bookingId).exec())!;
        const merged = cleanTags([...((fresh.attendees?.[hit.attendeeIndex] as BookingAttendee | undefined)?.tags ?? []), ...tags]);
        await writeTags(fresh, hit.attendeeIndex, merged, `import:${ctx.userId ?? "admin"}`);
        updated += 1;
      }
    }
    return { message: `${updated} registered guests tagged; ${pending} will be tagged when they register.`, created: pending, updated, skipped, errors: [] };
  },
});
