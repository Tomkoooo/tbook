import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { eventRepository } from "@tbook/db";
import type { MailTransporter } from "@tbook/services";
import type { EventAttendee } from "../shared/attendees";
import { EventEmailModel, type IEventEmail } from "../event-emails/model";
import { createEventEmail, sendSystemEmailToAttendee, systemEmailPlan } from "../event-emails/service";
import { plainTextToTemplateHtml } from "../event-emails/system";
import { BusCaptainInformModel, type IBusRoute } from "./model";
import { busForAttendee, getRouteForOrg, routeAttendees, type RouteAttendee } from "./service";

/**
 * The bus captain's details for passengers. A captain is often named only
 * after guests booked their bus, so:
 *  - {{bus.captainInfo}} renders the name and phone when the bus has a
 *    captain, else a "we'll tell you later" sentence;
 *  - each attendee who received an email with the captain's details (a
 *    confirmation using {{bus.captainName}} / {{bus.captainInfo}}, or the
 *    "bus_captain_notice" email) is recorded as informed for that bus and
 *    captain (BusCaptainInformModel);
 *  - the Buses page sends the "bus_captain_notice" email to the passengers
 *    of one bus who aren't informed about its current captain yet. A new
 *    captain makes everyone on the bus "not informed" again.
 */

export const CAPTAIN_INFO_LATER = "A járatod buszkapitányának személyéről és elérhetőségéről később, külön e-mailben értesítünk.";

export const BUS_CAPTAIN_NOTICE_DEFAULTS = {
  subject: "Buszkapitányod elérhetősége – {{eventName}}",
  message:
    "Kedves {{firstName}}!\n\nMegvan a buszjáratod ({{bus.code}}) kapitánya. Az utazással kapcsolatos kérdéseiddel őt keresheted.\n\n{{bus.captainInfo}}\n\nFelszállás: {{bus.city}}, {{bus.pickupPoint}} – indulás: {{bus.departure}}\nVisszaút: {{bus.returnInfo}}\n\nTovábbi információ: {{siteUrl}}\n\nÜdvözlettel:\nA szervezők",
};

/** A bus has a captain once both name and phone are set. */
export function hasCaptain(route: Pick<IBusRoute, "captainName" | "captainPhone">): boolean {
  return Boolean(route.captainName?.trim() && route.captainPhone?.trim());
}

/** Identifies the captain the details were sent about: a new name or phone = a new captain. */
export function captainKey(route: Pick<IBusRoute, "captainName" | "captainPhone">): string {
  return `${route.captainName.trim()}|${route.captainPhone.replace(/\s+/g, "")}`;
}

/**
 * {{bus.captainInfo}}: two lines (the email renders the line break as
 * <br>), or the "later" sentence while the bus has no captain.
 */
export function captainInfo(route: Pick<IBusRoute, "captainName" | "captainPhone"> | null): string {
  if (!route || !hasCaptain(route)) return CAPTAIN_INFO_LATER;
  return `Buszkapitány neve: ${route.captainName.trim()}\nBuszkapitány telefonszáma: ${route.captainPhone.trim()}`;
}

const CAPTAIN_PLACEHOLDER = /\{\{\s*bus\.(captainName|captainInfo)\s*\}\}/;

/** True when an email's text gives the captain's details. */
export function usesCaptainPlaceholders(body: string | null | undefined): boolean {
  return CAPTAIN_PLACEHOLDER.test(body ?? "");
}

export async function markCaptainInformed(
  route: IBusRoute,
  row: Pick<EventAttendee, "attendeeKey" | "booking">,
  via: string,
): Promise<void> {
  if (!hasCaptain(route)) return;
  await BusCaptainInformModel.updateOne(
    { eventId: route.eventId, attendeeKey: row.attendeeKey },
    {
      $set: {
        routeId: route._id,
        bookingId: new Types.ObjectId(String(row.booking._id)),
        captainKey: captainKey(route),
        test: Boolean(row.booking.isTest),
        via,
        informedAt: new Date(),
      },
    },
    { upsert: true },
  ).exec();
}

/**
 * After an event email reached an attendee: if its text carries the
 * captain's details and their bus has a captain, they are informed.
 */
export async function captainDetailsDelivered(email: Pick<IEventEmail, "body" | "trigger">, row: EventAttendee): Promise<void> {
  if (!usesCaptainPlaceholders(email.body)) return;
  const bus = await busForAttendee(row.booking, row.index);
  if (bus) await markCaptainInformed(bus.route, row, `email:${email.trigger}`);
}

/**
 * The passengers of a bus who haven't had its current captain's details:
 * active (confirmed/paid) registrations, live ones by default, `test: true`
 * for the test line. Empty while the bus has no captain.
 */
export async function captainNoticeRecipients(route: IBusRoute, opts: { test?: boolean } = {}): Promise<RouteAttendee[]> {
  if (!hasCaptain(route)) return [];
  const rows = await routeAttendees(route, { test: Boolean(opts.test) });
  if (rows.length === 0) return [];
  const informed = new Set(
    (
      await BusCaptainInformModel.find({ eventId: route.eventId, routeId: route._id, captainKey: captainKey(route), attendeeKey: { $in: rows.map((row) => row.attendeeKey) } }, { attendeeKey: 1 })
        .lean()
        .exec()
    ).map((doc) => doc.attendeeKey),
  );
  return rows.filter((row) => !informed.has(row.attendeeKey));
}

export interface CaptainNoticeResult {
  total: number;
  sent: number;
  failed: number;
  /** The event's "bus_captain_notice" email was created from the built-in text for this send. */
  createdTemplate: boolean;
}

/**
 * Sends the "bus_captain_notice" email to the bus's passengers who aren't
 * informed about its current captain, and marks each delivered one
 * informed. Without an event template of the trigger, one is created from
 * the built-in text first (so it is logged and editable like the others);
 * a template switched off refuses the send.
 */
export async function sendCaptainNotice(
  organizationId: string,
  routeId: string,
  opts: { test?: boolean; transporter?: MailTransporter } = {},
): Promise<CaptainNoticeResult> {
  const route = await getRouteForOrg(organizationId, routeId);
  if (!hasCaptain(route)) throw ActionError.validation("Set the captain's name and phone for this bus first.");
  const event = await eventRepository.findById(String(route.eventId));
  if (!event) throw ActionError.notFound("Event not found");
  let createdTemplate = false;
  if (!(await EventEmailModel.exists({ eventId: event._id, trigger: "bus_captain_notice" }))) {
    await createEventEmail(organizationId, String(event._id), {
      name: "Buszkapitány elérhetősége",
      subject: BUS_CAPTAIN_NOTICE_DEFAULTS.subject,
      body: plainTextToTemplateHtml(BUS_CAPTAIN_NOTICE_DEFAULTS.message),
      trigger: "bus_captain_notice",
      audience: "registered",
      active: true,
    });
    createdTemplate = true;
  }
  const plan = await systemEmailPlan(event, "bus_captain_notice");
  if (plan.state === "off") throw ActionError.validation("The “Bus captain notice” email is switched off for this event (Emails page). Switch it on to send.");
  if (plan.state !== "on") throw ActionError.validation("Switch on Event emails for this event to send the captain notice.");
  const recipients = await captainNoticeRecipients(route, { test: opts.test });
  const result: CaptainNoticeResult = { total: recipients.length, sent: 0, failed: 0, createdTemplate };
  for (const row of recipients) {
    const ok = await sendSystemEmailToAttendee(plan, row, { transporter: opts.transporter }).catch((error) => {
      console.error("[tbook] captain notice failed", String(route._id), row.attendeeKey, error);
      return false;
    });
    if (ok) {
      await markCaptainInformed(route, row, "bus_captain_notice");
      result.sent += 1;
    } else {
      result.failed += 1;
    }
  }
  return result;
}
