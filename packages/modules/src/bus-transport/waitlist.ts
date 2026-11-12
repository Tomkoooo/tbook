import { Types } from "mongoose";
import { BookingModel, eventRepository, type IBooking } from "@tbook/db";
import { resolveModules, type MailTransporter } from "@tbook/services";
import type { AttendeeFieldDef, BookingAttendee } from "@tbook/schemas";
import { ACTIVE_BOOKING_STATUSES, attendeeKeyOf, toEventAttendees, type EventAttendee } from "../shared/attendees";
import { eventSiteUrl, fillTemplate, sendModuleMail } from "../shared/mail";
import { BusRouteModel, BusSeatStateModel, BusWaitlistEntryModel } from "./model";
import { busRouteFields, isBusWaitlistValue } from "./service";

/**
 * The bus waitlist ("értesítést kérek"): guests whose bus answer is
 * "waitlist" hold no seat and wait in line, first come first served by
 * the time they chose it (registration or edit). When seats free up — a
 * cancellation, an edit or expiry releasing a seat, a new or re-activated
 * bus, more seats on a bus — everyone in line gets one email with a link
 * to the site, where they pick a real bus with POST /guest/update.
 *
 * Not spammy: a guest is emailed again only when seats became free after
 * their last email, or (on a later trigger while seats are still free)
 * once at least 6 hours have passed.
 */

export const BUS_WAITLIST_RENOTIFY_MS = 6 * 3600_000;

export const BUS_WAITLIST_DEFAULTS = {
  subject: "Felszabadult hely a buszon – {{event}}",
  message:
    "Szia {{name}}!\n\nJó hír: felszabadult hely a(z) {{event}} buszos transzferén. Ha még szeretnél busszal jönni, lépj be a weboldalon az azonosítóddal (törzsszámoddal), és válaszd ki a járatot: {{siteUrl}}\n\nA helyek érkezési sorrendben telnek be, ezért érdemes minél előbb választanod. Ha közben már nem kell a busz, nincs teendőd.\n\nÜdv,\nA szervezők",
};

export interface BusWaitlistConfig {
  busWaitlistSubject?: string;
  busWaitlistMessage?: string;
}

let transporterOverride: MailTransporter | undefined;
/** Test seam (falls back to the shared module transporter). */
export function setBusWaitlistTransporter(transporter: MailTransporter | undefined): void {
  transporterOverride = transporter;
}

/**
 * Brings the waitlist in line with a booking's attendees: an attendee
 * whose bus answer is "waitlist" is added (keeping their place if already
 * in line), anyone else is taken out. Called from the reservation step,
 * so registrations and edits both pass through it.
 */
export async function syncBusWaitlist(
  scope: { organizationId: string | null; eventId: string },
  bookingId: string,
  attendees: BookingAttendee[],
  schema: AttendeeFieldDef[],
): Promise<void> {
  const fields = busRouteFields(schema);
  if (fields.length === 0) return;
  const now = new Date();
  for (const [index, attendee] of attendees.entries()) {
    const key = attendeeKeyOf({ _id: bookingId } as never, attendee, index);
    const waiting = fields.some((field) => isBusWaitlistValue(attendee.fields?.[field.key]));
    if (waiting) {
      await BusWaitlistEntryModel.updateOne(
        { eventId: scope.eventId, attendeeKey: key },
        {
          $set: { bookingId: new Types.ObjectId(bookingId) },
          $setOnInsert: { organizationId: scope.organizationId ? new Types.ObjectId(scope.organizationId) : null, joinedAt: now, notifiedAt: null },
        },
        { upsert: true },
      ).exec();
    } else {
      await BusWaitlistEntryModel.deleteOne({ eventId: scope.eventId, attendeeKey: key }).exec();
    }
  }
}

/** Takes released attendees (cancelled / expired) out of the line. */
export async function removeFromBusWaitlist(booking: IBooking): Promise<void> {
  const keys = ((booking.attendees ?? []) as BookingAttendee[]).map((attendee, index) => attendeeKeyOf(booking, attendee, index));
  if (keys.length === 0) return;
  await BusWaitlistEntryModel.deleteMany({ eventId: booking.eventId, attendeeKey: { $in: keys } }).exec();
}

/** Records that seats became free, then emails the line. */
export async function seatsFreed(eventId: string, now = new Date()): Promise<void> {
  await BusSeatStateModel.updateOne({ eventId }, { $set: { lastFreedAt: now } }, { upsert: true }).exec();
  await notifyBusWaitlist(eventId, now);
}

async function freeSeats(eventId: string): Promise<number> {
  const routes = await BusRouteModel.find({ eventId, active: true }, { capacity: 1, seatsTaken: 1 }).lean().exec();
  return routes.reduce((sum, route) => sum + Math.max(route.capacity - route.seatsTaken, 0), 0);
}

interface WaitingGuest {
  entryId: Types.ObjectId;
  row: EventAttendee;
  joinedAt: Date;
  notifiedAt: Date | null;
}

/** The line in order; drops entries whose guest is no longer waiting (cancelled, or picked a bus). */
async function waitingGuests(eventId: string): Promise<WaitingGuest[]> {
  const entries = await BusWaitlistEntryModel.find({ eventId }).sort({ joinedAt: 1, _id: 1 }).exec();
  if (entries.length === 0) return [];
  const bookings = await BookingModel.find({ _id: { $in: [...new Set(entries.map((e) => String(e.bookingId)))] }, status: { $in: ACTIVE_BOOKING_STATUSES } }).exec();
  const rows = new Map<string, EventAttendee>();
  for (const booking of bookings) for (const row of toEventAttendees(booking)) rows.set(row.attendeeKey, row);
  const out: WaitingGuest[] = [];
  for (const entry of entries) {
    const row = rows.get(entry.attendeeKey);
    const stillWaiting = row && busRouteFields(row.booking.attendeeFieldSchema as AttendeeFieldDef[]).some((field) => isBusWaitlistValue(row.fields[field.key]));
    if (!row || !stillWaiting) {
      // Pending (unpaid) bookings keep their place; anything else is stale.
      const pending = await BookingModel.exists({ _id: entry.bookingId, status: { $in: ["pending", "checkout_started"] } });
      if (!pending) await BusWaitlistEntryModel.deleteOne({ _id: entry._id }).exec();
      continue;
    }
    out.push({ entryId: entry._id as Types.ObjectId, row, joinedAt: entry.joinedAt, notifiedAt: entry.notifiedAt });
  }
  return out;
}

/** 1-based place in the bus waitlist, or null when the attendee isn't waiting. */
export async function busWaitlistPosition(eventId: string, attendeeKey: string): Promise<number | null> {
  const mine = await BusWaitlistEntryModel.findOne({ eventId, attendeeKey }).exec();
  if (!mine) return null;
  const line = await waitingGuests(eventId);
  const index = line.findIndex((guest) => guest.row.attendeeKey === attendeeKey);
  return index >= 0 ? index + 1 : null;
}

function emailOf(row: EventAttendee): string {
  const field = ((row.booking.attendeeFieldSchema ?? []) as AttendeeFieldDef[]).find((f) => f.type === "email");
  const own = field ? String(row.fields[field.key] ?? "").trim() : "";
  return own || row.booking.customer?.email || "";
}

function phoneOf(row: EventAttendee): string {
  const field = ((row.booking.attendeeFieldSchema ?? []) as AttendeeFieldDef[]).find((f) => f.type === "phone");
  const own = field ? String(row.fields[field.key] ?? "").trim() : "";
  return own || row.booking.customer?.phone || "";
}

export interface BusWaitlistRow {
  position: number;
  name: string;
  registrationNumber: string | null;
  email: string;
  phone: string;
  joinedAt: Date;
  notifiedAt: Date | null;
}

/** The line for the console and the export. */
export async function listBusWaitlist(eventId: string): Promise<BusWaitlistRow[]> {
  return (await waitingGuests(eventId)).map((guest, index) => ({
    position: index + 1,
    name: guest.row.displayName,
    registrationNumber: guest.row.registrationNumber,
    email: emailOf(guest.row),
    phone: phoneOf(guest.row),
    joinedAt: guest.joinedAt,
    notifiedAt: guest.notifiedAt,
  }));
}

/**
 * Emails everyone in line that seats are free (when any are). Each guest
 * is claimed atomically before the email, so overlapping triggers can't
 * send twice. Returns how many were emailed.
 */
export async function notifyBusWaitlist(eventId: string, now = new Date()): Promise<number> {
  if (!(await BusWaitlistEntryModel.exists({ eventId }))) return 0;
  const event = await eventRepository.findById(eventId);
  if (!event) return 0;
  const modules = await resolveModules({ organizationId: event.organizationId ? String(event.organizationId) : null, event });
  if (!modules.isOn("bus-transport")) return 0;
  if ((await freeSeats(eventId)) <= 0) return 0;

  const state = await BusSeatStateModel.findOne({ eventId }).lean().exec();
  const lastFreedAt = state?.lastFreedAt ? new Date(state.lastFreedAt).getTime() : 0;
  const config = modules.config<BusWaitlistConfig>("bus-transport");
  const siteUrl = await eventSiteUrl(event);
  let sent = 0;
  for (const guest of await waitingGuests(eventId)) {
    const last = guest.notifiedAt ? guest.notifiedAt.getTime() : null;
    const due = last == null || lastFreedAt > last || now.getTime() - last >= BUS_WAITLIST_RENOTIFY_MS;
    if (!due) continue;
    const claimed = await BusWaitlistEntryModel.findOneAndUpdate({ _id: guest.entryId, notifiedAt: guest.notifiedAt }, { $set: { notifiedAt: now } }).exec();
    if (!claimed) continue;
    const values = { name: guest.row.displayName, event: event.name, siteUrl };
    try {
      await sendModuleMail(
        event,
        {
          to: emailOf(guest.row),
          subject: fillTemplate(config.busWaitlistSubject?.trim() || BUS_WAITLIST_DEFAULTS.subject, values),
          text: fillTemplate(config.busWaitlistMessage?.trim() || BUS_WAITLIST_DEFAULTS.message, values),
        },
        transporterOverride,
      );
      sent += 1;
    } catch (error) {
      console.error("[tbook] bus waitlist email failed", eventId, guest.row.attendeeKey, error);
    }
  }
  return sent;
}
