import { createHash, randomBytes } from "node:crypto";
import { ActionError } from "@tbook/actions";
import { eventRepository, type IEvent } from "@tbook/db";
import { normalizeUniqueValue } from "@tbook/domain";
import { checkRegistrationAnswers, createBookingWithCheckout, resolveModules, sendMail, type MailTransporter } from "@tbook/services";
import type { AttendeeFieldDef, BookingAttendee } from "@tbook/schemas";
import { FREE_REGISTRATION } from "../free-registration";
import { WaitlistEntryModel, type IWaitlistEntry, type WaitlistStatus } from "./model";

export const WAITLIST = "waitlist";

/**
 * Waitlist for a full event. When a place frees up (cancellation, expired
 * checkout, a guest leaving a group) the first person waiting either
 * - is registered automatically and told so ("auto"; free events only —
 *   a paid event always uses offers), or
 * - gets an email with a link, and the place is held for them for
 *   `offerHours` ("offer"); an unanswered offer expires and moves on.
 * No scheduler: expiry is checked whenever the waitlist is touched
 * (a release, the offer link, the console page).
 */
export interface WaitlistConfig {
  mode?: "auto" | "offer";
  offerHours?: string;
  offerSubject?: string;
  offerMessage?: string;
  registeredSubject?: string;
  registeredMessage?: string;
}

const DEFAULTS = {
  offerSubject: "Felszabadult egy hely – {{event}}",
  offerMessage:
    "Szia {{name}}! Jó hír: felszabadult egy hely a(z) {{event}} eseményen. {{hours}} óráig tartjuk neked, itt tudod lefoglalni: {{link}}",
  registeredSubject: "Bekerültél! – {{event}}",
  registeredMessage:
    "Szia {{name}}! Felszabadult egy hely, így a várólistáról regisztráltunk a(z) {{event}} eseményre. A visszaigazolást a QR-kóddal külön e-mailben küldjük.",
};

let transporterOverride: MailTransporter | undefined;
/** Test seam. */
export function setWaitlistTransporter(transporter: MailTransporter | undefined): void {
  transporterOverride = transporter;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const OPEN: WaitlistStatus[] = ["waiting", "offered"];

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

async function waitlistContext(event: IEvent) {
  const organizationId = event.organizationId ? String(event.organizationId) : null;
  const modules = await resolveModules({ organizationId, event });
  const config = modules.config<WaitlistConfig>(WAITLIST);
  const hours = Math.min(Math.max(Number.parseInt(config.offerHours ?? "", 10) || 48, 1), 24 * 14);
  // Auto-registering only works when no payment is needed.
  const mode: "auto" | "offer" = config.mode === "auto" && modules.isOn(FREE_REGISTRATION) ? "auto" : "offer";
  return { on: modules.isOn(WAITLIST), config, hours, mode, organizationId };
}

function freePlaces(event: IEvent): number {
  if (event.capacity == null) return Number.POSITIVE_INFINITY;
  return Math.max(event.capacity - (event.soldGuestCount ?? 0), 0);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}

async function notify(entry: IWaitlistEntry, event: IEvent, kind: "offer" | "registered", link = ""): Promise<void> {
  const { config, hours } = await waitlistContext(event);
  const subject = (kind === "offer" ? config.offerSubject : config.registeredSubject) || DEFAULTS[`${kind}Subject`];
  const message = (kind === "offer" ? config.offerMessage : config.registeredMessage) || DEFAULTS[`${kind}Message`];
  const values = { name: entry.customer.name, event: event.name, hours: String(hours), link };
  const html = escapeHtml(fill(message, { ...values, link: "\u0000" }))
    .split("\u0000")
    .join(link ? `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>` : "");
  try {
    await sendMail(
      event.organizationId ? String(event.organizationId) : null,
      { to: entry.customer.email, subject: fill(subject, values), html: `<p>${html.replace(/\n/g, "<br>")}</p>` },
      transporterOverride,
    );
    await WaitlistEntryModel.updateOne({ _id: entry._id }, { $set: { notifiedAt: new Date() } }).exec();
  } catch (error) {
    await WaitlistEntryModel.updateOne({ _id: entry._id }, { $set: { lastError: `Email failed: ${error instanceof Error ? error.message : String(error)}` } }).exec();
  }
}

// ---- Joining ---------------------------------------------------------------------

export interface JoinWaitlistInput {
  guests?: number;
  customer: { name: string; email: string; phone: string; note?: string };
  attendees?: BookingAttendee[];
  returnBaseUrl?: string | null;
}

/** True when the event is full and takes waitlist entries. */
export async function waitlistAvailable(event: IEvent): Promise<boolean> {
  const { on } = await waitlistContext(event);
  return on && event.capacity != null && freePlaces(event) <= 0;
}

export async function joinWaitlist(eventId: string, input: JoinWaitlistInput, groupId: string | null = null): Promise<{ entryId: string; position: number }> {
  const event = await eventRepository.findById(eventId);
  if (!event || event.status !== "active" || (groupId && String(event.groupId) !== groupId)) throw ActionError.notFound("Event not found or inactive.");
  const { on } = await waitlistContext(event);
  if (!on) throw ActionError.notFound("This event has no waitlist.");
  const guests = Math.max(Math.floor(Number(input.guests ?? 1)) || 1, 1);
  if (freePlaces(event) >= guests) throw ActionError.conflict("There are places left — please register instead.", "not_full");
  const name = String(input.customer?.name ?? "").trim();
  const email = String(input.customer?.email ?? "").trim().toLowerCase();
  const phone = String(input.customer?.phone ?? "").trim();
  if (!name || !phone || !/^\S+@\S+\.\S+$/.test(email)) throw ActionError.validation("Name, phone and a valid email are required.");

  const attendees = await checkRegistrationAnswers(eventId, guests, input.attendees ?? []);
  const open = await WaitlistEntryModel.find({ eventId: event._id, status: { $in: OPEN } }).exec();
  if (open.some((entry) => entry.customer.email === email)) throw ActionError.conflict("You're already on the waitlist.", "duplicate");
  const uniqueKeys = ((event.attendeeFieldSchema ?? []) as AttendeeFieldDef[]).filter((f) => f.unique).map((f) => f.key);
  const values = (list: unknown[]) =>
    (list as BookingAttendee[]).flatMap((a) => uniqueKeys.map((key) => `${key}\u0000${normalizeUniqueValue(a.fields?.[key])}`)).filter((v) => !v.endsWith("\u0000"));
  const mine = new Set(values(attendees));
  if (open.some((entry) => values(entry.attendees).some((v) => mine.has(v)))) throw ActionError.conflict("You're already on the waitlist.", "duplicate");

  const entry = await WaitlistEntryModel.create({
    organizationId: event.organizationId ?? null,
    eventId: event._id,
    guests,
    customer: { name, email, phone, note: String(input.customer.note ?? "").slice(0, 1000) },
    attendees,
    returnBaseUrl: input.returnBaseUrl?.trim() || null,
  });
  return { entryId: String(entry._id), position: open.filter((e) => e.status === "waiting").length + 1 };
}

// ---- Processing --------------------------------------------------------------------

/** Ends offers nobody answered in time and gives their held places back. */
export async function expireOffers(eventId: string, now = new Date()): Promise<number> {
  const stale = await WaitlistEntryModel.find({ eventId, status: "offered", offerExpiresAt: { $lt: now } }).exec();
  let count = 0;
  for (const entry of stale) {
    const claimed = await WaitlistEntryModel.findOneAndUpdate({ _id: entry._id, status: "offered" }, { $set: { status: "expired", heldGuests: 0 } }).exec();
    if (claimed && claimed.heldGuests > 0) await eventRepository.releaseCapacity(eventId, claimed.heldGuests);
    if (claimed) count += 1;
  }
  return count;
}

function bookingInput(entry: IWaitlistEntry) {
  return {
    eventId: String(entry.eventId),
    guests: entry.guests,
    customer: { name: entry.customer.name, email: entry.customer.email, phone: entry.customer.phone, note: entry.customer.note },
    attendees: entry.attendees as BookingAttendee[],
    returnBaseUrl: entry.returnBaseUrl,
  };
}

const running = new Map<string, Promise<void>>();

/** Fills free places from the waitlist, first come first served. Serialised per event within a process. */
export function processWaitlist(eventId: string): Promise<void> {
  const previous = running.get(eventId) ?? Promise.resolve();
  const next = previous.then(() => processOnce(eventId)).catch((error) => console.error("[tbook] waitlist processing failed", eventId, error));
  running.set(eventId, next);
  void next.finally(() => {
    if (running.get(eventId) === next) running.delete(eventId);
  });
  return next;
}

async function processOnce(eventId: string): Promise<void> {
  await expireOffers(eventId);
  for (;;) {
    const event = await eventRepository.findById(eventId);
    if (!event) return;
    const { on, mode, hours } = await waitlistContext(event);
    if (!on) return;
    const entry = await WaitlistEntryModel.findOne({ eventId: event._id, status: "waiting" }).sort({ createdAt: 1 }).exec();
    if (!entry || freePlaces(event) < entry.guests) return;

    if (mode === "auto") {
      try {
        const result = await createBookingWithCheckout(bookingInput(entry), { allowClosedSales: true });
        await WaitlistEntryModel.updateOne({ _id: entry._id }, { $set: { status: "registered", bookingId: result.bookingId, lastError: "" } }).exec();
        await notify(entry, event, "registered");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/capacity/i.test(message)) return;
        await WaitlistEntryModel.updateOne({ _id: entry._id }, { $set: { status: "failed", lastError: message } }).exec();
      }
      continue;
    }

    const held = await eventRepository.reserveCapacity(eventId, entry.guests);
    if (!held) return;
    const token = randomBytes(24).toString("base64url");
    const offered = await WaitlistEntryModel.findOneAndUpdate(
      { _id: entry._id, status: "waiting" },
      { $set: { status: "offered", offerTokenHash: hashToken(token), offeredAt: new Date(), offerExpiresAt: new Date(Date.now() + hours * 3600_000), heldGuests: entry.guests, lastError: "" } },
      { returnDocument: "after" },
    ).exec();
    if (!offered) {
      await eventRepository.releaseCapacity(eventId, entry.guests);
      continue;
    }
    await notify(offered, event, "offer", `${appUrl()}/waitlist/${token}`);
  }
}

// ---- Offers --------------------------------------------------------------------------

export interface OfferView {
  status: WaitlistStatus;
  eventName: string;
  name: string;
  guests: number;
  expiresAt: string | null;
}

async function entryByToken(token: string): Promise<IWaitlistEntry | null> {
  if (!token || token.length < 20) return null;
  return WaitlistEntryModel.findOne({ offerTokenHash: hashToken(token) }).exec();
}

export async function getOffer(token: string): Promise<OfferView | null> {
  let entry = await entryByToken(token);
  if (!entry) return null;
  if (entry.status === "offered" && entry.offerExpiresAt && entry.offerExpiresAt < new Date()) {
    await processWaitlist(String(entry.eventId));
    entry = (await WaitlistEntryModel.findById(entry._id).exec())!;
  }
  const event = await eventRepository.findById(String(entry.eventId));
  return { status: entry.status, eventName: event?.name ?? "", name: entry.customer.name, guests: entry.guests, expiresAt: entry.offerExpiresAt?.toISOString() ?? null };
}

export async function acceptOffer(token: string): Promise<{ status: "confirmed"; registrationNumber: string | null } | { status: "payment"; checkoutUrl: string | null }> {
  const entry = await entryByToken(token);
  if (!entry) throw ActionError.notFound("This link isn't valid.");
  if (entry.status === "offered" && entry.offerExpiresAt && entry.offerExpiresAt < new Date()) {
    await processWaitlist(String(entry.eventId));
    throw ActionError.validation("Sorry, this offer has expired.");
  }
  // Claim it, so a double click can't register twice.
  const claimed = await WaitlistEntryModel.findOneAndUpdate({ _id: entry._id, status: "offered" }, { $set: { status: "registered" } }).exec();
  if (!claimed) throw ActionError.validation(entry.status === "registered" ? "You're already registered." : "This offer is no longer open.");
  try {
    // The place is already held for this entry: register over the cap, then give the hold back.
    const result = await createBookingWithCheckout(bookingInput(claimed), { allowClosedSales: true, allowOverCapacity: true });
    await eventRepository.releaseCapacity(String(claimed.eventId), claimed.heldGuests);
    await WaitlistEntryModel.updateOne({ _id: claimed._id }, { $set: { bookingId: result.bookingId, heldGuests: 0, lastError: "" } }).exec();
    return result.status === "confirmed" ? { status: "confirmed", registrationNumber: result.registrationNumber ?? null } : { status: "payment", checkoutUrl: result.checkoutUrl };
  } catch (error) {
    await WaitlistEntryModel.updateOne({ _id: claimed._id }, { $set: { status: "offered", lastError: error instanceof Error ? error.message : String(error) } }).exec();
    throw error;
  }
}

export async function declineOffer(token: string): Promise<void> {
  const entry = await entryByToken(token);
  if (!entry) throw ActionError.notFound("This link isn't valid.");
  const claimed = await WaitlistEntryModel.findOneAndUpdate({ _id: entry._id, status: "offered" }, { $set: { status: "declined", heldGuests: 0 } }).exec();
  if (!claimed) return;
  if (claimed.heldGuests > 0) await eventRepository.releaseCapacity(String(claimed.eventId), claimed.heldGuests);
  await processWaitlist(String(claimed.eventId));
}

// ---- Console ---------------------------------------------------------------------------

export interface WaitlistRow {
  id: string;
  position: number | null;
  status: WaitlistStatus;
  name: string;
  email: string;
  phone: string;
  guests: number;
  createdAt: Date;
  offerExpiresAt: Date | null;
  bookingId: string | null;
  lastError: string;
}

async function eventForOrg(organizationId: string, eventId: string): Promise<IEvent> {
  const event = await eventRepository.findById(eventId);
  if (!event || String(event.organizationId) !== organizationId) throw ActionError.notFound("Event not found");
  return event;
}

export async function listWaitlist(organizationId: string, eventId: string): Promise<{ rows: WaitlistRow[]; mode: "auto" | "offer"; hours: number; free: number | null }> {
  const event = await eventForOrg(organizationId, eventId);
  await expireOffers(eventId);
  const { mode, hours } = await waitlistContext(event);
  const entries = await WaitlistEntryModel.find({ eventId: event._id }).sort({ createdAt: 1 }).exec();
  let position = 0;
  const rows = entries.map((entry) => ({
    id: String(entry._id),
    position: entry.status === "waiting" ? ++position : null,
    status: entry.status,
    name: entry.customer.name,
    email: entry.customer.email,
    phone: entry.customer.phone,
    guests: entry.guests,
    createdAt: entry.createdAt,
    offerExpiresAt: entry.offerExpiresAt,
    bookingId: entry.bookingId ? String(entry.bookingId) : null,
    lastError: entry.lastError,
  }));
  return { rows, mode, hours, free: event.capacity == null ? null : freePlaces(event) };
}

export async function removeWaitlistEntry(organizationId: string, entryId: string): Promise<void> {
  const entry = await WaitlistEntryModel.findById(entryId).exec();
  if (!entry || String(entry.organizationId) !== organizationId) throw ActionError.notFound("Entry not found");
  const claimed = await WaitlistEntryModel.findOneAndUpdate({ _id: entry._id, status: { $in: OPEN } }, { $set: { status: "removed", heldGuests: 0 } }).exec();
  if (claimed && claimed.heldGuests > 0) {
    await eventRepository.releaseCapacity(String(claimed.eventId), claimed.heldGuests);
    await processWaitlist(String(claimed.eventId));
  }
}

export async function processWaitlistForOrg(organizationId: string, eventId: string): Promise<void> {
  await eventForOrg(organizationId, eventId);
  await processWaitlist(eventId);
}
