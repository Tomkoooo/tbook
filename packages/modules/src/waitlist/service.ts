import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { eventRepository, type IEvent } from "@tbook/db";
import { isFieldVisible, normalizeUniqueValue } from "@tbook/domain";
import {
  checkRegistrationAnswers,
  createBookingWithCheckout,
  createTestBookingWithCheckout,
  resolveAttendeeDisplayName,
  resolveModules,
  sendMail,
  type EventContext,
  type HeldIdentifier,
  type MailTransporter,
} from "@tbook/services";
import type { AttendeeFieldDef, BookingAttendee } from "@tbook/schemas";
import { BusRouteModel } from "../bus-transport/model";
import { BUS_WAITLIST_VALUE, busRouteFields, seatsByRoute } from "../bus-transport/service";
import { sendSystemEmailToContact, systemEmailPlan } from "../event-emails/service";
import type { SystemEmailTrigger } from "../event-emails/model";
import { FREE_REGISTRATION } from "../free-registration";
import { eventSiteUrl } from "../shared/mail";
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
 *
 * Positions: the rank among `waiting` entries in joining order, 1 = next
 * in line. An entry counts once whatever its group size; an `offered`
 * entry has no position (its place is held until `offerExpiresAt`).
 * While an entry is open its identifying answers (e.g. employee ID) are
 * held: the same ID can't book or join again until it leaves.
 *
 * Test entries (v1 preview key + `X-TBook-Test: 1`) form their own queue:
 * positions count test entries only, a test entry is promoted only when a
 * test booking is cancelled (one place per freed test guest, no capacity
 * involved), live cancellations never touch them and test cancellations
 * never promote a live entry. Their IDs are held among test records only.
 * Their emails go out with "[TESZT] " subjects.
 */
export interface WaitlistConfig {
  mode?: "auto" | "offer";
  offerHours?: string;
  offerSubject?: string;
  offerMessage?: string;
  registeredSubject?: string;
  registeredMessage?: string;
  joinedSubject?: string;
  joinedMessage?: string;
}

export const WAITLIST_DEFAULTS = {
  joinedSubject: "Felkerültél a várólistára – {{event}}",
  joinedMessage:
    "Szia {{name}}!\n\nA(z) {{event}} jelenleg betelt, ezért felírtunk a várólistára. A helyed a sorban: {{position}}.\n\nHa felszabadul egy hely, e-mailben értesítünk. A helyedet bármikor megnézheted, vagy le is iratkozhatsz a weboldalon az azonosítóddal (törzsszámoddal): {{siteUrl}}\n\nÜdv,\nA szervezők",
  offerSubject: "Felszabadult egy hely – {{event}}",
  offerMessage:
    "Szia {{name}}! Jó hír: felszabadult egy hely a(z) {{event}} eseményen. {{hours}} óráig tartjuk neked, itt tudod lefoglalni: {{link}}",
  registeredSubject: "Bekerültél! – {{event}}",
  registeredMessage:
    "Szia {{name}}! Felszabadult egy hely, így a várólistáról regisztráltunk a(z) {{event}} eseményre. A visszaigazolást a QR-kóddal külön e-mailben küldjük.",
};
const DEFAULTS = WAITLIST_DEFAULTS;

/** Added to the "registered" email when the chosen bus was full by then. */
export const BUS_FALLBACK_NOTE =
  "Fontos: a választott buszjáraton időközben elfogytak a helyek, ezért felírtunk a buszos várólistára. Ha felszabadul egy hely, e-mailben értesítünk, és a weboldalon választhatsz járatot.";

let transporterOverride: MailTransporter | undefined;
/** Test seam. */
export function setWaitlistTransporter(transporter: MailTransporter | undefined): void {
  transporterOverride = transporter;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const OPEN: WaitlistStatus[] = ["waiting", "offered"];

/** The live queue, or with `test` the test queue. */
function pool(test: boolean | null | undefined): Record<string, unknown> {
  return test ? { isTest: true } : { isTest: { $ne: true } };
}

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

type NoticeKind = "offer" | "registered" | "joined";

const NOTICE_TRIGGERS: Record<NoticeKind, SystemEmailTrigger> = { joined: "waitlist_joined", offer: "waitlist_offer", registered: "waitlist_registered" };

/**
 * The guest's waitlist email. Precedence: the event's email of the
 * trigger (event-emails; switched off = nothing is sent) > the module
 * settings text > the built-in text.
 */
async function notify(
  entry: IWaitlistEntry,
  event: IEvent,
  kind: NoticeKind,
  extra: { link?: string; position?: number; note?: string; registrationNumber?: string | null } = {},
): Promise<void> {
  const { config, hours } = await waitlistContext(event);
  const link = extra.link ?? "";
  const plan = await systemEmailPlan(event, NOTICE_TRIGGERS[kind]);
  if (plan.state === "off") return;
  if (plan.state === "on") {
    const first = (entry.attendees as BookingAttendee[])[0];
    const ok = await sendSystemEmailToContact(
      plan,
      { key: `waitlist:${String(entry._id)}`, to: entry.customer.email, name: entry.customer.name, test: entry.isTest, fields: first?.fields ?? {} },
      {
        extra: {
          position: extra.position != null ? String(extra.position) : "",
          hours: String(hours),
          link,
          busNote: extra.note ?? "",
          ...(kind === "registered" ? { registrationNumber: extra.registrationNumber ?? "" } : {}),
        },
        transporter: transporterOverride,
      },
    );
    await WaitlistEntryModel.updateOne({ _id: entry._id }, { $set: ok ? { notifiedAt: new Date() } : { lastError: "Email failed (see the email's delivery log)" } }).exec();
    return;
  }
  const subject = config[`${kind}Subject`]?.trim() || DEFAULTS[`${kind}Subject`];
  let message = config[`${kind}Message`]?.trim() || DEFAULTS[`${kind}Message`];
  if (extra.note) message = `${message}\n\n${extra.note}`;
  const siteUrl = await eventSiteUrl(event);
  const values = { name: entry.customer.name, event: event.name, hours: String(hours), link, position: extra.position != null ? String(extra.position) : "", siteUrl };
  const html = escapeHtml(fill(message, { ...values, link: "\u0000", siteUrl: "\u0001" }))
    .split("\u0000")
    .join(link ? `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>` : "")
    .split("\u0001")
    .join(siteUrl ? `<a href="${escapeHtml(siteUrl)}">${escapeHtml(siteUrl)}</a>` : "");
  try {
    await sendMail(
      event.organizationId ? String(event.organizationId) : null,
      { to: entry.customer.email, subject: fill(subject, values), html: `<p>${html.replace(/\n/g, "<br>")}</p>`, test: entry.isTest },
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

function uniqueKeysOf(event: IEvent): AttendeeFieldDef[] {
  return ((event.attendeeFieldSchema ?? []) as AttendeeFieldDef[]).filter((f) => f.unique || f.identifier);
}

/** "<fieldKey>\u0000<normalized value>" for each identifying answer of the attendees. */
function identifierValues(event: IEvent, list: unknown[]): string[] {
  const keys = uniqueKeysOf(event).map((f) => f.key);
  return (list as BookingAttendee[])
    .flatMap((a) => keys.map((key) => `${key}\u0000${normalizeUniqueValue(a.fields?.[key])}`))
    .filter((v) => !v.endsWith("\u0000"));
}

function openEntries(event: IEvent, test = false): Promise<IWaitlistEntry[]> {
  return WaitlistEntryModel.find({ eventId: event._id, status: { $in: OPEN }, ...pool(test) }).sort({ createdAt: 1, _id: 1 }).exec();
}

/** Rank among waiting entries (1 = next); null for an offered/closed entry. */
async function positionOf(entry: IWaitlistEntry): Promise<number | null> {
  if (entry.status !== "waiting") return null;
  const ahead = await WaitlistEntryModel.countDocuments({
    eventId: entry.eventId,
    status: "waiting",
    ...pool(entry.isTest),
    $or: [{ createdAt: { $lt: entry.createdAt } }, { createdAt: entry.createdAt, _id: { $lt: entry._id } }],
  }).exec();
  return ahead + 1;
}

export interface JoinWaitlistOptions {
  /** Preview mode: draft events allowed; everything is checked, nothing saved or sent. */
  preview?: boolean;
  /**
   * Test mode (preview key + X-TBook-Test): draft events allowed, the entry
   * is saved in the test queue and emailed ("[TESZT] "). No "not full"
   * check: test data doesn't depend on live capacity.
   */
  test?: boolean;
}

export type JoinWaitlistResult =
  | { entryId: string; position: number }
  | { entryId: string; position: number; test: true }
  | { preview: true; entryId: null; position: number };

export async function joinWaitlist(eventId: string, input: JoinWaitlistInput, groupId: string | null = null, opts: JoinWaitlistOptions = {}): Promise<JoinWaitlistResult> {
  const event = await eventRepository.findById(eventId);
  const test = Boolean(opts.test);
  const visible = event?.status === "active" || ((opts.preview || test) && event?.status === "draft");
  if (!event || !visible || (groupId && String(event.groupId) !== groupId)) throw ActionError.notFound("Az esemény nem található.");
  const { on } = await waitlistContext(event);
  if (!on) throw ActionError.notFound("Ennek az eseménynek nincs várólistája.");
  const guests = Math.max(Math.floor(Number(input.guests ?? 1)) || 1, 1);
  if (!test && freePlaces(event) >= guests) throw ActionError.conflict("Még van szabad hely – regisztrálj inkább!", "not_full");
  const name = String(input.customer?.name ?? "").trim();
  const email = String(input.customer?.email ?? "").trim().toLowerCase();
  const phone = String(input.customer?.phone ?? "").trim();
  if (!name || !phone || !/^\S+@\S+\.\S+$/.test(email)) throw ActionError.validation("Add meg a neved, a telefonszámod és egy érvényes e-mail-címet.");

  const attendees = await checkRegistrationAnswers(eventId, guests, input.attendees ?? [], { isTest: test });
  const open = await openEntries(event, test);
  if (open.some((entry) => entry.customer.email === email)) throw ActionError.conflict("Ezzel az e-mail-címmel már várólistán vagy.", "duplicate");
  const mine = new Set(identifierValues(event, attendees));
  if (open.some((entry) => identifierValues(event, entry.attendees).some((v) => mine.has(v)))) throw ActionError.conflict("Ezzel az azonosítóval már várólistán vagy.", "duplicate");

  const position = open.filter((e) => e.status === "waiting").length + 1;
  if (opts.preview && !test) return { preview: true, entryId: null, position };

  const entry = await WaitlistEntryModel.create({
    organizationId: event.organizationId ?? null,
    eventId: event._id,
    guests,
    customer: { name, email, phone, note: String(input.customer.note ?? "").slice(0, 1000) },
    attendees,
    returnBaseUrl: input.returnBaseUrl?.trim() || null,
    isTest: test,
  });
  const actual = (await positionOf(entry)) ?? position;
  await notify(entry, event, "joined", { position: actual });
  return test ? { entryId: String(entry._id), position: actual, test: true } : { entryId: String(entry._id), position: actual };
}

// ---- Guest status and leaving ------------------------------------------------------

/**
 * The open entry one of whose attendees has this identifying answer (e.g.
 * employee ID). Live entries only; with `includeTest` (a request carrying
 * the preview key) the test queue is searched first.
 */
export async function findOpenEntryByCode(event: IEvent, code: string, opts: { includeTest?: boolean } = {}): Promise<IWaitlistEntry | null> {
  const value = normalizeUniqueValue(code);
  if (!value) return null;
  const keys = uniqueKeysOf(event).map((f) => f.key);
  if (keys.length === 0) return null;
  for (const test of opts.includeTest ? [true, false] : [false]) {
    for (const entry of await openEntries(event, test)) {
      if ((entry.attendees as BookingAttendee[]).some((a) => keys.some((key) => normalizeUniqueValue(a.fields?.[key]) === value))) return entry;
    }
  }
  return null;
}

/** Guest-facing options: `preview` = the request carries the group's preview key (draft events and test entries are visible). */
export interface WaitlistGuestOptions {
  preview?: boolean;
}

export interface WaitlistStatusView {
  status: WaitlistStatus;
  /** Rank among waiting entries, 1 = next; null while a place is offered. */
  position: number | null;
  guests: number;
  names: string[];
  createdAt: string;
  offerExpiresAt: string | null;
}

async function guestWaitlistEvent(eventId: string, groupId: string | null, opts: WaitlistGuestOptions): Promise<IEvent> {
  const event = await eventRepository.findById(eventId);
  if (!event || (groupId && String(event.groupId) !== groupId) || (event.status === "draft" && !opts.preview)) throw ActionError.notFound("Az esemény nem található.");
  if (!(await waitlistContext(event)).on) throw ActionError.notFound("Ennek az eseménynek nincs várólistája.");
  return event;
}

async function entryForCode(eventId: string, code: string, groupId: string | null, opts: WaitlistGuestOptions): Promise<{ event: IEvent; entry: IWaitlistEntry }> {
  const event = await guestWaitlistEvent(eventId, groupId, opts);
  await expireOffers(eventId);
  const entry = await findOpenEntryByCode(event, code, { includeTest: opts.preview });
  if (!entry) throw ActionError.notFound("Ezzel az azonosítóval nem találtunk várólistás jelentkezést.");
  return { event, entry };
}

export async function waitlistStatus(eventId: string, code: string, groupId: string | null = null, opts: WaitlistGuestOptions = {}): Promise<{ entry: WaitlistStatusView; test?: true }> {
  const { event, entry } = await entryForCode(eventId, code, groupId, opts);
  const schema = (event.attendeeFieldSchema ?? []) as AttendeeFieldDef[];
  const attendees = entry.attendees as BookingAttendee[];
  return {
    entry: {
      status: entry.status,
      position: await positionOf(entry),
      guests: entry.guests,
      names: attendees.map((_, index) => resolveAttendeeDisplayName(index, attendees as never, schema, entry.customer.name, entry.guests)),
      createdAt: entry.createdAt.toISOString(),
      offerExpiresAt: entry.offerExpiresAt?.toISOString() ?? null,
    },
    ...(entry.isTest ? { test: true as const } : {}),
  };
}

/** The guest leaves the waitlist: the entry is removed, a held place goes to the next in line. */
export async function leaveWaitlist(eventId: string, code: string, groupId: string | null = null, opts: WaitlistGuestOptions = {}): Promise<{ left: true; test?: true }> {
  const { entry } = await entryForCode(eventId, code, groupId, opts);
  const claimed = await WaitlistEntryModel.findOneAndUpdate({ _id: entry._id, status: { $in: OPEN } }, { $set: { status: "removed", heldGuests: 0, lastError: "left by guest" } }).exec();
  if (!claimed) throw ActionError.notFound("Ezzel az azonosítóval nem találtunk várólistás jelentkezést.");
  await afterOpenEntryClosed(claimed);
  return claimed.isTest ? { left: true, test: true } : { left: true };
}

/** An open entry was closed (left, removed, declined): a held (or, in the test queue, offered) place moves on. */
async function afterOpenEntryClosed(closed: IWaitlistEntry): Promise<void> {
  const eventId = String(closed.eventId);
  if (closed.isTest) {
    if (closed.status === "offered") await processWaitlist(eventId, { test: true, freed: closed.guests });
    return;
  }
  if (closed.heldGuests > 0) await eventRepository.releaseCapacity(eventId, closed.heldGuests);
  await processWaitlist(eventId);
}

/** Identifier holder: an ID in an open entry can't register (or join) again. */
export async function waitlistHeldIdentifier(ctx: EventContext, values: Array<{ fieldKey: string; value: string }>): Promise<HeldIdentifier | null> {
  if (!ctx.modules.isOn(WAITLIST) || values.length === 0) return null;
  // A test registration is checked against test entries only, a live one against live entries.
  const open = await openEntries(ctx.event, ctx.isTest);
  if (open.length === 0) return null;
  const wanted = new Set(values.map((v) => `${v.fieldKey}\u0000${v.value}`));
  for (const entry of open) {
    const hit = identifierValues(ctx.event, entry.attendees).find((v) => wanted.has(v));
    if (!hit) continue;
    const [fieldKey, value] = hit.split("\u0000") as [string, string];
    const label = ((ctx.event.attendeeFieldSchema ?? []) as AttendeeFieldDef[]).find((f) => f.key === fieldKey)?.label ?? fieldKey;
    return {
      fieldKey,
      value,
      reason: "waitlist",
      message: `Ezzel a(z) ${label} értékkel már várólistán vagy erre az eseményre. A helyedet a várólista oldalon nézheted meg, vagy ott le is iratkozhatsz.`,
    };
  }
  return null;
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

function bookingInput(entry: IWaitlistEntry, attendees = entry.attendees as BookingAttendee[]) {
  return {
    eventId: String(entry.eventId),
    guests: entry.guests,
    customer: { name: entry.customer.name, email: entry.customer.email, phone: entry.customer.phone, note: entry.customer.note },
    attendees,
    returnBaseUrl: entry.returnBaseUrl,
  };
}

/**
 * The stored answers fitted to the buses as they are now: every bus that
 * can't seat them is replaced by the bus waitlist (`fallback`). The answer
 * may also date from the other bus state: a bus left empty while no bus was
 * offered goes on the bus waitlist once buses exist (the guest is told when
 * a seat frees up and picks one), and a bus waitlist answer is dropped while
 * no bus is offered (there is nothing to wait for).
 */
async function withFullBusesWaitlisted(event: IEvent, attendees: BookingAttendee[]): Promise<{ attendees: BookingAttendee[]; fallback: boolean }> {
  const schema = (event.attendeeFieldSchema ?? []) as AttendeeFieldDef[];
  const fields = busRouteFields(schema);
  if (fields.length === 0) return { attendees, fallback: false };
  const busesOffered = Boolean(await BusRouteModel.exists({ eventId: event._id, active: true }).exec());
  const full = new Set<string>();
  for (const [routeId, count] of seatsByRoute(attendees, schema)) {
    const route = Types.ObjectId.isValid(routeId) ? await BusRouteModel.findOne({ _id: routeId, eventId: event._id }).lean().exec() : null;
    if (!route || !route.active || route.seatsTaken + count > route.capacity) full.add(routeId);
  }
  let fallback = false;
  const fitted = attendees.map((attendee) => {
    const answers = { ...(attendee.fields ?? {}) };
    for (const field of fields) {
      const value = String(answers[field.key] ?? "");
      if (full.has(value)) {
        answers[field.key] = BUS_WAITLIST_VALUE;
        fallback = true;
      } else if (!busesOffered && value === BUS_WAITLIST_VALUE) {
        delete answers[field.key];
      } else if (busesOffered && !value && isFieldVisible(field, answers)) {
        answers[field.key] = BUS_WAITLIST_VALUE;
      }
    }
    return { ...attendee, fields: answers };
  });
  return { attendees: fitted, fallback };
}

/**
 * Registers an entry. If its chosen bus has filled up meanwhile, the
 * registration still goes through with the guest on the bus waitlist.
 */
async function registerEntry(entry: IWaitlistEntry, event: IEvent, opts: { allowOverCapacity?: boolean }) {
  const stored = entry.attendees as BookingAttendee[];
  const attempt = async () => {
    // A full bus is no longer a live choice: move those answers to the bus waitlist first.
    const { attendees, fallback: busFallback } = await withFullBusesWaitlisted(event, stored);
    // A test entry becomes a test booking (no capacity, test ID namespace, "[TESZT] " emails).
    const result = entry.isTest
      ? await createTestBookingWithCheckout(bookingInput(entry, attendees))
      : await createBookingWithCheckout(bookingInput(entry, attendees), { allowClosedSales: true, ...opts });
    if (JSON.stringify(attendees) !== JSON.stringify(stored)) await WaitlistEntryModel.updateOne({ _id: entry._id }, { $set: { attendees } }).exec();
    return { result, busFallback };
  };
  try {
    return await attempt();
  } catch (error) {
    // The last seat went between the check and the booking: check again.
    if ((error as { code?: string }).code !== "bus_full") throw error;
    return attempt();
  }
}

const running = new Map<string, Promise<void>>();

export interface ProcessWaitlistOptions {
  /** Process the test queue instead of the live one. */
  test?: boolean;
  /** Test queue only: places freed by the test release (test entries take no live capacity). */
  freed?: number;
}

/**
 * Fills free places from the waitlist, first come first served. Serialised
 * per event (and queue) within a process. The live queue fills live
 * capacity; the test queue moves only by `freed` places of a test release.
 */
export function processWaitlist(eventId: string, opts: ProcessWaitlistOptions = {}): Promise<void> {
  const key = opts.test ? `${eventId}:test` : eventId;
  const previous = running.get(key) ?? Promise.resolve();
  const run = () => (opts.test ? processTestOnce(eventId, opts.freed ?? 0) : processOnce(eventId));
  const next = previous.then(run).catch((error) => console.error("[tbook] waitlist processing failed", eventId, error));
  running.set(key, next);
  void next.finally(() => {
    if (running.get(key) === next) running.delete(key);
  });
  return next;
}

/**
 * The test queue: up to `freed` guests, in joining order, are registered
 * (auto) or offered a place (offer; nothing held). Stops at the first entry
 * that doesn't fit, like the live queue.
 */
async function processTestOnce(eventId: string, freed: number): Promise<void> {
  let left = freed;
  while (left > 0) {
    const event = await eventRepository.findById(eventId);
    if (!event) return;
    const { on, mode, hours } = await waitlistContext(event);
    if (!on) return;
    const entry = await WaitlistEntryModel.findOne({ eventId: event._id, status: "waiting", isTest: true }).sort({ createdAt: 1, _id: 1 }).exec();
    if (!entry || entry.guests > left) return;
    left -= entry.guests;
    if (mode === "auto") {
      const claimed = await WaitlistEntryModel.findOneAndUpdate({ _id: entry._id, status: "waiting" }, { $set: { status: "registered" } }, { returnDocument: "after" }).exec();
      if (!claimed) continue;
      try {
        const { result, busFallback } = await registerEntry(claimed, event, {});
        await WaitlistEntryModel.updateOne({ _id: entry._id }, { $set: { bookingId: result.bookingId, lastError: "" } }).exec();
        await notify(claimed, event, "registered", { registrationNumber: result.registrationNumber, ...(busFallback ? { note: BUS_FALLBACK_NOTE } : {}) });
      } catch (error) {
        await WaitlistEntryModel.updateOne({ _id: entry._id }, { $set: { status: "failed", lastError: error instanceof Error ? error.message : String(error) } }).exec();
      }
      continue;
    }
    const token = randomBytes(24).toString("base64url");
    const offered = await WaitlistEntryModel.findOneAndUpdate(
      { _id: entry._id, status: "waiting" },
      { $set: { status: "offered", offerTokenHash: hashToken(token), offeredAt: new Date(), offerExpiresAt: new Date(Date.now() + hours * 3600_000), heldGuests: 0, lastError: "" } },
      { returnDocument: "after" },
    ).exec();
    if (offered) await notify(offered, event, "offer", { link: `${appUrl()}/waitlist/${token}` });
  }
}

async function processOnce(eventId: string): Promise<void> {
  await expireOffers(eventId);
  for (;;) {
    const event = await eventRepository.findById(eventId);
    if (!event) return;
    const { on, mode, hours } = await waitlistContext(event);
    if (!on) return;
    // The live queue only: test entries never take live places.
    const entry = await WaitlistEntryModel.findOne({ eventId: event._id, status: "waiting", ...pool(false) }).sort({ createdAt: 1, _id: 1 }).exec();
    if (!entry || freePlaces(event) < entry.guests) return;

    if (mode === "auto") {
      // Claim the entry first: no second process can promote it too, and its held ID is released for the booking.
      const claimed = await WaitlistEntryModel.findOneAndUpdate({ _id: entry._id, status: "waiting" }, { $set: { status: "registered" } }, { returnDocument: "after" }).exec();
      if (!claimed) continue;
      try {
        const { result, busFallback } = await registerEntry(claimed, event, {});
        await WaitlistEntryModel.updateOne({ _id: entry._id }, { $set: { bookingId: result.bookingId, lastError: "" } }).exec();
        await notify(claimed, event, "registered", { registrationNumber: result.registrationNumber, ...(busFallback ? { note: BUS_FALLBACK_NOTE } : {}) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if ((error as { code?: string }).code === "capacity_full") {
          await WaitlistEntryModel.updateOne({ _id: entry._id }, { $set: { status: "waiting" } }).exec();
          return;
        }
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
    await notify(offered, event, "offer", { link: `${appUrl()}/waitlist/${token}` });
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
  if (!entry) throw ActionError.notFound("Ez a link nem érvényes.");
  if (entry.status === "offered" && entry.offerExpiresAt && entry.offerExpiresAt < new Date()) {
    await processWaitlist(String(entry.eventId));
    throw ActionError.validation("Sajnos ez az ajánlat lejárt.");
  }
  // Claim it, so a double click can't register twice.
  const claimed = await WaitlistEntryModel.findOneAndUpdate({ _id: entry._id, status: "offered" }, { $set: { status: "registered" } }).exec();
  if (!claimed) throw ActionError.validation(entry.status === "registered" ? "Már regisztráltál." : "Ez az ajánlat már nem érvényes.");
  try {
    const event = await eventRepository.findById(String(claimed.eventId));
    if (!event) throw ActionError.notFound("Az esemény nem található.");
    // The place is already held for this entry: register over the cap, then give the hold back.
    const { result } = await registerEntry(claimed, event, { allowOverCapacity: true });
    if (claimed.heldGuests > 0) await eventRepository.releaseCapacity(String(claimed.eventId), claimed.heldGuests);
    await WaitlistEntryModel.updateOne({ _id: claimed._id }, { $set: { bookingId: result.bookingId, heldGuests: 0, lastError: "" } }).exec();
    return result.status === "confirmed" ? { status: "confirmed", registrationNumber: result.registrationNumber ?? null } : { status: "payment", checkoutUrl: result.checkoutUrl };
  } catch (error) {
    await WaitlistEntryModel.updateOne({ _id: claimed._id }, { $set: { status: "offered", lastError: error instanceof Error ? error.message : String(error) } }).exec();
    throw error;
  }
}

export async function declineOffer(token: string): Promise<void> {
  const entry = await entryByToken(token);
  if (!entry) throw ActionError.notFound("Ez a link nem érvényes.");
  const claimed = await WaitlistEntryModel.findOneAndUpdate({ _id: entry._id, status: "offered" }, { $set: { status: "declined", heldGuests: 0 } }).exec();
  if (!claimed) return;
  await afterOpenEntryClosed(claimed);
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
  /** A test entry (own queue; its position counts test entries only). */
  isTest: boolean;
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
  const entries = await WaitlistEntryModel.find({ eventId: event._id }).sort({ createdAt: 1, _id: 1 }).exec();
  const positions = { live: 0, test: 0 };
  const rows = entries.map((entry) => ({
    id: String(entry._id),
    position: entry.status === "waiting" ? ++positions[entry.isTest ? "test" : "live"] : null,
    status: entry.status,
    name: entry.customer.name,
    email: entry.customer.email,
    phone: entry.customer.phone,
    guests: entry.guests,
    createdAt: entry.createdAt,
    offerExpiresAt: entry.offerExpiresAt,
    bookingId: entry.bookingId ? String(entry.bookingId) : null,
    lastError: entry.lastError,
    isTest: Boolean(entry.isTest),
  }));
  return { rows, mode, hours, free: event.capacity == null ? null : freePlaces(event) };
}

export async function removeWaitlistEntry(organizationId: string, entryId: string): Promise<void> {
  const entry = await WaitlistEntryModel.findById(entryId).exec();
  if (!entry || String(entry.organizationId) !== organizationId) throw ActionError.notFound("Entry not found");
  const claimed = await WaitlistEntryModel.findOneAndUpdate({ _id: entry._id, status: { $in: OPEN } }, { $set: { status: "removed", heldGuests: 0 } }).exec();
  if (claimed && (claimed.heldGuests > 0 || (claimed.isTest && claimed.status === "offered"))) await afterOpenEntryClosed(claimed);
}

export async function processWaitlistForOrg(organizationId: string, eventId: string): Promise<void> {
  await eventForOrg(organizationId, eventId);
  await processWaitlist(eventId);
}
