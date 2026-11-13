import { ActionError } from "@tbook/actions";
import { eventRepository, type IBooking, type IEvent } from "@tbook/db";
import { isFieldVisible } from "@tbook/domain";
import { bookingEventContext, cancelBookingAttendee, editBookingAttendee, editableFieldSchema, resolveModules } from "@tbook/services";
import type { AttendeeFieldDef, AttendeeFieldValue, BookingAttendee } from "@tbook/schemas";
import { BUS_TRANSPORT } from "../bus-transport";
import { formatDeparture, routeForAttendee } from "../bus-transport/service";
import { busWaitlistPosition } from "../bus-transport/waitlist";
import { attendeeKeyOf, findAttendeeByCode, toEventAttendees } from "../shared/attendees";
import { eventSiteUrl, fillTemplate, sendModuleMail } from "../shared/mail";

export const GUEST_PORTAL = "guest-portal";

/**
 * Guest self-service for an event's website: a guest finds their own
 * registration with their registration number or their identifying answer
 * (e.g. employee ID), sees its details (bus, captain, rules), changes
 * answers, or cancels. No login: the code is the key, so lookups are
 * rate-limited by the API, contact details are masked, and the
 * identifying answers themselves can't be changed here.
 */
export interface GuestPortalConfig {
  allowEdit?: "yes" | "no";
  allowCancel?: "yes" | "no";
  /** Comma-separated question keys guests may not change (identifying/unique ones never can). */
  lockedFields?: string;
  cancelSubject?: string;
  cancelMessage?: string;
}

export const GUEST_PORTAL_DEFAULTS = {
  cancelSubject: "Regisztráció lemondva – {{event}}",
  cancelMessage:
    "Szia {{name}}!\n\nA(z) {{event}} eseményre szóló regisztrációdat ({{registrationNumber}}) lemondtuk, a QR-kódod már nem érvényes.\n\nHa meggondolod magad, amíg van szabad hely, a weboldalon újra jelentkezhetsz: {{siteUrl}}\n\nÜdv,\nA szervezők",
};


interface Found {
  booking: IBooking;
  attendeeIndex: number;
  event: IEvent;
  config: GuestPortalConfig;
}

function plain<T>(value: T): T {
  return typeof (value as { toObject?: () => T }).toObject === "function" ? (value as unknown as { toObject: () => T }).toObject() : value;
}

/** `preview`: the request carries the group's preview key — draft events and test registrations are visible. */
export interface GuestPortalOptions {
  preview?: boolean;
}

async function portalEvent(eventId: string, groupId: string | null, opts: GuestPortalOptions = {}): Promise<{ event: IEvent; config: GuestPortalConfig }> {
  const event = await eventRepository.findById(eventId);
  if (!event || (groupId && String(event.groupId) !== groupId) || (event.status === "draft" && !opts.preview)) throw ActionError.notFound("Az esemény nem található.");
  const modules = await resolveModules({ organizationId: event.organizationId ? String(event.organizationId) : null, event });
  if (!modules.isOn(GUEST_PORTAL)) throw ActionError.notFound("Ennél az eseménynél nem érhető el az önkiszolgálás.");
  return { event, config: modules.config<GuestPortalConfig>(GUEST_PORTAL) };
}

function identifyingKeys(schema: AttendeeFieldDef[]): string[] {
  return schema.filter((field) => field.identifier || field.unique).map((field) => field.key);
}

/** Finds the guest a code belongs to: a registration number, or an identifying answer. */
export async function findGuest(eventId: string, code: string, groupId: string | null = null, opts: GuestPortalOptions = {}): Promise<Found> {
  const { event, config } = await portalEvent(eventId, groupId, opts);
  if (!code.trim()) throw ActionError.validation("Add meg a regisztrációs számodat vagy az azonosítódat.");
  // Test registrations only for a request with the preview key (searched first).
  const hit = await findAttendeeByCode(event, code, { includeTest: opts.preview });
  if (!hit) throw ActionError.notFound("Ezzel a kóddal nem találtunk regisztrációt.");
  return { ...hit, event, config };
}

function maskEmail(value: string): string {
  const [user, domain] = value.split("@");
  if (!domain) return "***";
  return `${user!.slice(0, 1)}***@${domain}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D+/g, "");
  return digits.length <= 3 ? "***" : `***${digits.slice(-3)}`;
}

function isContactField(field: AttendeeFieldDef): boolean {
  return field.type === "email" || field.type === "phone" || /phone|telefon|e-?mail/i.test(field.key);
}

function changesOpen(event: IEvent): boolean {
  return new Date(event.startDate).getTime() > Date.now();
}

function lockedKeys(schema: AttendeeFieldDef[], config: GuestPortalConfig): string[] {
  const configured = (config.lockedFields ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  return [...new Set([...identifyingKeys(schema), ...configured])];
}

export interface GuestView {
  eventId: string;
  eventName: string;
  registrationNumber: string | null;
  name: string;
  /** Answers; contact details are masked. */
  fields: Record<string, AttendeeFieldValue>;
  /** The form, for an edit screen: every question with its live options and whether the guest may change it. */
  form: Array<AttendeeFieldDef & { editable: boolean; masked: boolean }>;
  bus: {
    code: string;
    city: string;
    pickupPoint: string;
    departureAt: string | null;
    departure: string;
    returnInfo: string;
    captainName: string;
    captainPhone: string;
  } | null;
  /** Added: on the bus waitlist ("értesítést kérek"): 1 = next in line; null otherwise. */
  busWaitlist: { position: number } | null;
  /** The bus module's transfer rules text (e.g. the 15-minute wait rule). */
  transferRules: string;
  canEdit: boolean;
  canCancel: boolean;
  /** Added: present (true) only for a test registration. */
  test?: true;
}

export async function guestView(found: Found): Promise<GuestView> {
  const { booking, attendeeIndex, event, config } = found;
  const { ctx } = await bookingEventContext(booking);
  const schema = await editableFieldSchema(booking, ctx);
  const attendee = plain(booking.attendees![attendeeIndex]!) as BookingAttendee;
  const row = toEventAttendees(booking)[attendeeIndex]!;
  const locked = new Set(lockedKeys(schema, config));
  const open = changesOpen(event);
  const fields: Record<string, AttendeeFieldValue> = {};
  for (const field of schema) {
    const value = attendee.fields?.[field.key];
    if (value == null) continue;
    fields[field.key] = isContactField(field) ? (field.type === "email" || /mail/i.test(field.key) ? maskEmail(String(value)) : maskPhone(String(value))) : value;
  }
  const route = await routeForAttendee(booking, attendeeIndex);
  const busOn = ctx.modules.isOn(BUS_TRANSPORT);
  const waitPosition = busOn ? await busWaitlistPosition(String(event._id), attendeeKeyOf(booking, attendee, attendeeIndex), Boolean(booking.isTest)) : null;
  return {
    eventId: String(event._id),
    eventName: event.name,
    registrationNumber: attendee.registrationNumber ?? null,
    name: row.displayName,
    fields,
    form: schema.map((field) => ({ ...field, editable: open && config.allowEdit !== "no" && !locked.has(field.key), masked: isContactField(field) })),
    bus:
      route && busOn
        ? {
            code: route.code,
            city: route.city,
            pickupPoint: route.pickupPoint,
            departureAt: route.departureAt ? route.departureAt.toISOString() : null,
            departure: formatDeparture(route.departureAt),
            returnInfo: route.returnInfo,
            captainName: route.captainName,
            captainPhone: route.captainPhone,
          }
        : null,
    busWaitlist: waitPosition != null ? { position: waitPosition } : null,
    transferRules: busOn ? (ctx.modules.config<{ transferRules?: string }>(BUS_TRANSPORT).transferRules ?? "") : "",
    canEdit: open && config.allowEdit !== "no",
    canCancel: open && config.allowCancel !== "no" && booking.totalHuf <= 0,
    ...(booking.isTest ? { test: true as const } : {}),
  };
}

export async function lookupGuest(eventId: string, code: string, groupId: string | null = null, opts: GuestPortalOptions = {}): Promise<GuestView> {
  return guestView(await findGuest(eventId, code, groupId, opts));
}

/** Changes the guest's own answers; locked and masked-but-unchanged answers keep their stored value. */
export async function updateGuest(eventId: string, code: string, input: Record<string, unknown>, groupId: string | null = null, opts: GuestPortalOptions = {}): Promise<GuestView> {
  const found = await findGuest(eventId, code, groupId, opts);
  const view = await guestView(found);
  if (!view.canEdit) throw ActionError.forbidden("Ezt a regisztrációt már nem lehet módosítani.");
  const fields: Record<string, AttendeeFieldValue> = {};
  for (const field of view.form) {
    if (!field.editable || !(field.key in input)) continue;
    const raw = input[field.key];
    if (field.masked && String(raw ?? "") === String(view.fields[field.key] ?? "")) continue;
    fields[field.key] = typeof raw === "number" ? raw : typeof raw === "boolean" ? String(raw) : String(raw ?? "").slice(0, 2000);
  }
  // Answers to questions that are now hidden (e.g. bus after "no transfer") are dropped.
  const merged = { ...((plain(found.booking.attendees![found.attendeeIndex]!) as BookingAttendee).fields ?? {}), ...fields };
  for (const field of view.form) if (!isFieldVisible(field, merged) && field.key in merged) fields[field.key] = "";
  const updated = await editBookingAttendee(String(found.booking._id), found.attendeeIndex, fields, {
    by: "guest",
    lockedKeys: view.form.filter((field) => !field.editable).map((field) => field.key),
  });
  // Automatic emails after the change (e.g. the bus email once a bus is picked) are sent by the
  // event-emails module's edit hook, the same for guest and organizer edits.
  return guestView({ ...found, booking: updated });
}

export async function cancelGuest(
  eventId: string,
  code: string,
  reason: string,
  groupId: string | null = null,
  opts: GuestPortalOptions = {},
): Promise<{ cancelled: true; registrationNumber: string | null; test?: true }> {
  const found = await findGuest(eventId, code, groupId, opts);
  const view = await guestView(found);
  if (!view.canCancel) throw ActionError.forbidden("Ezt a regisztrációt itt nem lehet lemondani. Kérjük, keresd a szervezőket.");
  await cancelBookingAttendee(String(found.booking._id), found.attendeeIndex, { by: "guest", reason: reason.slice(0, 500) });
  return { cancelled: true, registrationNumber: view.registrationNumber, ...(found.booking.isTest ? { test: true as const } : {}) };
}

/**
 * Release hook: a cancelled guest (by themselves on the site, or by an
 * organizer) gets a short confirmation email. One per cancelled attendee.
 */
export async function sendCancellationEmails(booking: IBooking): Promise<void> {
  const event = await eventRepository.findById(String(booking.eventId));
  if (!event) return;
  const modules = await resolveModules({ organizationId: event.organizationId ? String(event.organizationId) : null, event });
  if (!modules.isOn(GUEST_PORTAL)) return;
  const config = modules.config<GuestPortalConfig>(GUEST_PORTAL);
  const siteUrl = await eventSiteUrl(event);
  const schema = (booking.attendeeFieldSchema ?? []) as AttendeeFieldDef[];
  const emailField = schema.find((field) => field.type === "email");
  for (const row of toEventAttendees(booking)) {
    const to = (emailField ? String(row.fields[emailField.key] ?? "").trim() : "") || booking.customer?.email || "";
    const values = { name: row.displayName, event: event.name, registrationNumber: row.registrationNumber ?? booking.registrationNumber ?? "", siteUrl };
    try {
      await sendModuleMail(event, {
        to,
        subject: fillTemplate(config.cancelSubject?.trim() || GUEST_PORTAL_DEFAULTS.cancelSubject, values),
        text: fillTemplate(config.cancelMessage?.trim() || GUEST_PORTAL_DEFAULTS.cancelMessage, values),
        test: Boolean(booking.isTest),
      });
    } catch (error) {
      console.error("[tbook] cancellation email failed", String(booking._id), row.attendeeKey, error);
    }
  }
}
