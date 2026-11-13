import { bookingRepository, eventRepository, organizationRepository, type IBooking } from "@tbook/db";
import type { AttendeeFieldDef, AttendeeFieldValue } from "@tbook/schemas";
import { AFTER_BOOKING_PAID_HOOKS } from "./checkout-service";
import {
  enrollTDartsPair,
  enrollTDartsPlayer,
  enrollTDartsTeam,
  resolveTDartsCredentials,
  TDartsApiError,
  updateTDartsTeam,
  withdrawTDartsTeam,
  type FetchLike,
  type TDartsCredentials,
  type TDartsTeamMember,
} from "./tdarts-partner-client";

/**
 * Ported from the legacy plugin's services/tdarts-sync-service.ts +
 * lib/tdarts-client.ts + lib/tdarts-enroll-mapping.ts — enrolls a paid
 * booking's participants into the linked external tDarts tournament roster
 * (partner API — idempotent per participant). Best-effort: failures are
 * recorded per-participant on `booking.tdartsSync` and never thrown, so a
 * tDarts outage never blocks payment confirmation.
 *
 * Deferred (lower priority per this pass's scope, admin-triggered, not on
 * the payment path): resyncEvent / syncAllPaidBookingsForEvent backfill.
 */

// Signing, credentials and the HTTP calls live in tdarts-partner-client.ts;
// re-exported here because callers and tests have always imported them from
// this module.
export {
  enrollTDartsPair,
  enrollTDartsPlayer,
  enrollTDartsTeam,
  resolveTDartsCredentials,
  signTDartsRequest,
  TDartsApiError,
  updateTDartsTeam,
  withdrawTDartsTeam,
  type FetchLike,
  type OrgTDartsSettingsLike,
  type TDartsCredentials,
  type TDartsEnrollPairResult,
  type TDartsEnrollResult,
  type TDartsTeamMember,
} from "./tdarts-partner-client";

// ---------------------------------------------------------------------------
// Fraud-guard contact extraction — refuses to enroll a participant whose
// name/email fell back to the booking buyer's own contact info.
// ---------------------------------------------------------------------------

const COUNTRY_ALIASES: [string[], string][] = [
  [["magyarorszag", "magyar", "hungary", "hungarian", "hu"], "HU"],
  [["romania", "roman", "romanian", "ro"], "RO"],
  [["szlovakia", "slovakia", "slovak", "sk"], "SK"],
  [["ausztria", "austria", "austrian", "at"], "AT"],
  [["nemetorszag", "germany", "german", "de"], "DE"],
  [["united kingdom", "great britain", "britain", "british", "england", "english", "scotland", "wales", "uk", "gb"], "GB"],
  [["ireland", "irish", "ie"], "IE"],
  [["france", "french", "fr"], "FR"],
  [["spain", "spanish", "es"], "ES"],
  [["italy", "italian", "it"], "IT"],
  [["netherlands", "holland", "dutch", "nl"], "NL"],
  [["belgium", "belgian", "be"], "BE"],
  [["switzerland", "swiss", "ch"], "CH"],
  [["denmark", "danish", "dk"], "DK"],
  [["sweden", "swedish", "se"], "SE"],
  [["norway", "norwegian", "no"], "NO"],
  [["poland", "polish", "pl"], "PL"],
  [["united states", "usa", "america", "american", "us"], "US"],
];

function buildCountryTable(): Map<string, string> {
  const table = new Map<string, string>();
  for (const [aliases, iso2] of COUNTRY_ALIASES) for (const alias of aliases) table.set(alias, iso2);
  return table;
}
const COUNTRY_TABLE = buildCountryTable();

function normalizeCountryKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();
}

function guessCountryIso2(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const key = normalizeCountryKey(raw);
  return key ? COUNTRY_TABLE.get(key) : undefined;
}

const NAME_KEYWORDS = ["nev", "name"];
const COUNTRY_KEYWORDS = ["allampolgar", "nemzetiseg", "country", "nationality", "orszag"];
const DOB_KEYWORDS = ["szulet", "birth", "dob"];

function fieldLabelKey(field: AttendeeFieldDef): string {
  return `${field.key} ${field.label}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function findFieldByKeywords(schema: AttendeeFieldDef[], keywords: string[], types?: AttendeeFieldDef["type"][]): AttendeeFieldDef | undefined {
  return schema.find((f) => {
    if (types && !types.includes(f.type)) return false;
    const haystack = fieldLabelKey(f);
    return keywords.some((kw) => haystack.includes(kw));
  });
}

export interface TDartsParticipantContact {
  email: string;
  name: string;
  country?: string;
  birthDate?: string;
  /** True when a name/email field exists on the schema but the participant left it blank, so it fell back to the buyer's own contact. */
  nameIsFallback: boolean;
  emailIsFallback: boolean;
}

/**
 * Field keys are moderator-assigned slugs with no fixed schema — matched by
 * label/key keyword first, falling back to type (email is unambiguous; name
 * is the first required/any text field). Country is only ever taken from a
 * keyword-matched field, never guessed from an arbitrary select.
 */
export function extractParticipantContact(
  schema: AttendeeFieldDef[],
  fields: Record<string, AttendeeFieldValue> | undefined,
  fallback: { name: string; email: string },
): TDartsParticipantContact {
  const values = fields ?? {};

  const emailField = schema.find((f) => f.type === "email") ?? findFieldByKeywords(schema, ["email", "mail"]);
  const rawEmail = (emailField ? String(values[emailField.key] ?? "") : "").trim();
  const email = rawEmail || fallback.email;
  const emailIsFallback = Boolean(emailField) && !rawEmail;

  const nameField = findFieldByKeywords(schema, NAME_KEYWORDS, ["text"]) ?? schema.find((f) => f.type === "text" && f.required) ?? schema.find((f) => f.type === "text");
  const rawName = (nameField ? String(values[nameField.key] ?? "") : "").trim();
  const name = rawName || fallback.name;
  const nameIsFallback = Boolean(nameField) && !rawName;

  const countryField = findFieldByKeywords(schema, COUNTRY_KEYWORDS, ["text", "select"]);
  let country: string | undefined;
  if (countryField) {
    const raw = values[countryField.key];
    if (countryField.type === "select") {
      const choiceLabel = countryField.choices?.find((c) => c.value === raw)?.label;
      country = guessCountryIso2(choiceLabel) ?? guessCountryIso2(raw != null ? String(raw) : undefined);
    } else {
      country = guessCountryIso2(raw != null ? String(raw) : undefined);
    }
  }

  const dobField = schema.find((f) => f.type === "date") ?? findFieldByKeywords(schema, DOB_KEYWORDS, ["date"]);
  let birthDate: string | undefined;
  if (dobField) {
    const raw = values[dobField.key];
    if (raw != null && /^\d{4}-\d{2}-\d{2}$/.test(String(raw))) birthDate = String(raw);
  }

  return { email, name, country, birthDate, nameIsFallback, emailIsFallback };
}

// ---------------------------------------------------------------------------
// Team roster (3+ players per ticket) → tDarts `enroll-team` payload.
// ---------------------------------------------------------------------------

const TEAM_NAME_KEYWORDS = ["csapat", "team", "klub", "club"];

function schemaEmailField(schema: AttendeeFieldDef[]): AttendeeFieldDef | undefined {
  return schema.find((f) => f.type === "email") ?? findFieldByKeywords(schema, ["email", "mail"]);
}

export type TDartsTeamRoster = { ok: true; teamName: string; members: TDartsTeamMember[] } | { ok: false; error: string };

/**
 * Builds the team tDarts will see from one team ticket.
 *
 * The fraud guard is stricter than for solo tickets, because a roster is
 * usually typed by one person: a member is only ever given the email typed
 * into *their own* field. A member without one becomes a guest player on
 * tDarts — never an account under the buyer's address. A blank name is
 * refused outright. tDarts needs one contact with an email, so the first
 * member who has one is sent first; a team where nobody has one is refused.
 *
 * Team name: a team-level field that looks like one ("Csapatnév", "Team
 * name", "Club"), else "<first player> +N" — the same wording the voucher
 * uses, and a moderator can rename it on tDarts.
 */
export function buildTDartsTeamRoster(
  teamFieldSchema: AttendeeFieldDef[],
  teamFields: Record<string, AttendeeFieldValue> | undefined,
  memberFieldSchema: AttendeeFieldDef[],
  members: { fields?: Record<string, AttendeeFieldValue> }[],
  buyer: { name: string; email: string },
): TDartsTeamRoster {
  if (members.length < 3) {
    return { ok: false, error: `A team ticket needs at least 3 roster members, got ${members.length}.` };
  }
  const emailField = schemaEmailField(memberFieldSchema);
  const roster: TDartsTeamMember[] = [];
  for (const [index, member] of members.entries()) {
    const contact = extractParticipantContact(memberFieldSchema, member.fields, buyer);
    if (contact.nameIsFallback || !contact.name.trim()) {
      return { ok: false, error: `Team member ${index + 1} has no name — refusing to enroll them on tDarts as the booking buyer.` };
    }
    const ownEmail = emailField ? String(member.fields?.[emailField.key] ?? "").trim().toLowerCase() : "";
    roster.push({ name: contact.name, email: ownEmail || undefined, country: contact.country, birthDate: contact.birthDate });
  }

  const emails = roster.map((m) => m.email).filter(Boolean);
  if (new Set(emails).size !== emails.length) {
    return { ok: false, error: "Two team members have the same email address — each player needs their own (or none)." };
  }
  const contactIndex = roster.findIndex((m) => m.email);
  if (contactIndex === -1) {
    return { ok: false, error: "No team member has an email address — tDarts needs at least one contact per team." };
  }
  const ordered = [roster[contactIndex]!, ...roster.filter((_, i) => i !== contactIndex)];

  const nameField = findFieldByKeywords(teamFieldSchema, TEAM_NAME_KEYWORDS, ["text"]);
  const typedName = nameField ? String(teamFields?.[nameField.key] ?? "").trim() : "";
  const teamName = typedName.length >= 2 ? typedName : `${roster[0]!.name} +${roster.length - 1}`;
  return { ok: true, teamName: teamName.slice(0, 120), members: ordered };
}

// ---------------------------------------------------------------------------
// Orchestration — three enrollment strategies keyed off registrationUnit/playersPerTicket.
// ---------------------------------------------------------------------------

export type TDartsSyncEntryResult = {
  participantKey: string;
  tournamentCode: string;
  status: "synced" | "waiting" | "failed" | "skipped" | "withdrawn";
  playerId: string | null;
  rosterStatus: "applied" | "waiting" | null;
  error: string | null;
  syncedAt: Date | null;
};

function entry(participantKey: string, tournamentCode: string, patch: Partial<TDartsSyncEntryResult>): TDartsSyncEntryResult {
  return { participantKey, tournamentCode, status: "failed", playerId: null, rosterStatus: null, error: null, syncedAt: null, ...patch };
}

type SyncContext = {
  booking: IBooking;
  tournamentCode: string;
  creds: TDartsCredentials;
  isTeamEvent: boolean;
  isPairEvent: boolean;
};

/** Everything a tDarts call for this booking needs — or null when the event/organization is not linked to tDarts. */
async function loadSyncContext(bookingId: string, purpose: string): Promise<SyncContext | null> {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) return null;

  const event = await eventRepository.findById(String(booking.eventId));
  const tournamentCode = event?.tdarts?.enabled ? event.tdarts.tournamentCode : null;
  if (!tournamentCode) return null;

  const org = booking.organizationId ? await organizationRepository.findById(String(booking.organizationId)) : null;
  const creds = resolveTDartsCredentials(org?.settings?.tdarts ?? null);
  if (!creds) {
    console.warn(`[tbook] tDarts ${purpose} skipped for booking ${bookingId} — organization has no tDarts partner credentials configured`);
    return null;
  }
  const isTeamEvent = event?.registrationUnit === "team";
  return { booking, tournamentCode, creds, isTeamEvent, isPairEvent: isTeamEvent && event?.teamMemberLimit === 2 };
}

/** tDarts' own wording plus its stable code, so the org manager sees why and support can search for it. */
function describeTDartsError(error: unknown, fallback: string): string {
  if (error instanceof TDartsApiError && error.code) return `${error.message} [${error.code}]`;
  return error instanceof Error ? error.message : fallback;
}

/**
 * `person` (solo) → one enroll call per attendee. `team` with exactly 2
 * roster slots (doubles/pairs) → one pair-enroll call per ticket. `team`
 * with 3+ roster slots → one `enroll-team` call per ticket: the whole roster
 * becomes a single team entrant on a tDarts team tournament.
 */
export async function syncBookingToTDarts(bookingId: string, opts?: { fetchImpl?: FetchLike }): Promise<void> {
  const context = await loadSyncContext(bookingId, "sync");
  if (!context) return;
  const { booking, tournamentCode, creds, isTeamEvent, isPairEvent } = context;
  const attendees = booking.attendees ?? [];
  const attendeeFieldSchema = booking.attendeeFieldSchema ?? [];
  const teamMemberFieldSchema = booking.teamMemberFieldSchema ?? [];
  const customer = { name: booking.customer.name, email: booking.customer.email };
  const totalHuf = booking.totalHuf;
  const currency = booking.currency;
  const paidAt = booking.paidAt;
  const results: TDartsSyncEntryResult[] = [];

  async function syncSolo(key: string, fields: Record<string, AttendeeFieldValue> | undefined) {
    const contact = extractParticipantContact(attendeeFieldSchema, fields, customer);
    if (contact.nameIsFallback || contact.emailIsFallback) {
      results.push(entry(key, tournamentCode!, { status: "failed", error: "Attendee left their name/email blank — refusing to enroll them on tDarts as the booking buyer." }));
      return;
    }
    try {
      const enrolled = await enrollTDartsPlayer(
        creds!,
        { tournamentCode: tournamentCode!, email: contact.email, name: contact.name, country: contact.country, birthDate: contact.birthDate, orderId: `${bookingId}:${key}`, amount: totalHuf, currency, paidAt: paidAt?.toISOString() },
        opts?.fetchImpl,
      );
      results.push(entry(key, tournamentCode!, { status: enrolled.rosterStatus === "waiting" ? "waiting" : "synced", playerId: enrolled.playerId, rosterStatus: enrolled.rosterStatus, syncedAt: new Date() }));
    } catch (error) {
      results.push(entry(key, tournamentCode!, { status: "failed", error: error instanceof Error ? error.message : "tDarts enroll failed" }));
    }
  }

  async function syncPair(key: string, members: { fields: Record<string, AttendeeFieldValue> }[]) {
    if (members.length !== 2) {
      results.push(entry(key, tournamentCode!, { status: "failed", error: `Expected exactly 2 team members for a pair ticket, got ${members.length}` }));
      return;
    }
    const [c1, c2] = members.map((m) => extractParticipantContact(teamMemberFieldSchema, m.fields, customer)) as [TDartsParticipantContact, TDartsParticipantContact];
    if (c1.nameIsFallback || c1.emailIsFallback || c2.nameIsFallback || c2.emailIsFallback) {
      const bad = c1.nameIsFallback || c1.emailIsFallback ? 1 : 2;
      results.push(entry(key, tournamentCode!, { status: "failed", error: `Team member ${bad} left their name/email blank — refusing to enroll them on tDarts as the booking buyer.` }));
      return;
    }
    try {
      const enrolled = await enrollTDartsPair(
        creds!,
        { tournamentCode: tournamentCode!, member1: c1, member2: c2, orderId: `${bookingId}:${key}`, amount: totalHuf, currency, paidAt: paidAt?.toISOString() },
        opts?.fetchImpl,
      );
      results.push(entry(key, tournamentCode!, { status: enrolled.rosterStatus === "waiting" ? "waiting" : "synced", playerId: enrolled.pairPlayerId, rosterStatus: enrolled.rosterStatus, syncedAt: new Date() }));
    } catch (error) {
      results.push(entry(key, tournamentCode!, { status: "failed", error: error instanceof Error ? error.message : "tDarts pair enroll failed" }));
    }
  }

  async function syncTeam(key: string, attendee: { fields?: Record<string, AttendeeFieldValue>; members?: { fields?: Record<string, AttendeeFieldValue> }[] }) {
    const roster = buildTDartsTeamRoster(attendeeFieldSchema, attendee.fields, teamMemberFieldSchema, attendee.members ?? [], customer);
    if (!roster.ok) {
      results.push(entry(key, tournamentCode!, { status: "failed", error: roster.error }));
      return;
    }
    try {
      const enrolled = await enrollTDartsTeam(
        creds!,
        { tournamentCode: tournamentCode!, teamName: roster.teamName, members: roster.members, orderId: `${bookingId}:${key}`, amount: totalHuf, currency, paidAt: paidAt?.toISOString() },
        opts?.fetchImpl,
      );
      results.push(entry(key, tournamentCode!, { status: enrolled.rosterStatus === "waiting" ? "waiting" : "synced", playerId: enrolled.teamPlayerId, rosterStatus: enrolled.rosterStatus, syncedAt: new Date() }));
    } catch (error) {
      results.push(entry(key, tournamentCode!, { status: "failed", error: describeTDartsError(error, "tDarts team enroll failed") }));
    }
  }

  if (attendees.length === 0) {
    if (!isTeamEvent && booking.guests === 1) await syncSolo("0", undefined);
  } else if (isTeamEvent && !isPairEvent) {
    await Promise.all(attendees.map((a, ai) => syncTeam(`${ai}`, a)));
  } else if (isPairEvent) {
    await Promise.all(attendees.map((a, ai) => syncPair(`${ai}`, a.members ?? [])));
  } else {
    await Promise.all(attendees.map((a, ai) => syncSolo(`${ai}`, a.fields)));
  }

  if (results.length > 0) {
    await bookingRepository.updateById(bookingId, { tdartsSync: results as unknown as IBooking["tdartsSync"] });
  }
}

type StoredSyncEntry = TDartsSyncEntryResult;

function storedEntries(booking: IBooking): StoredSyncEntry[] {
  // toObject-free copy: the entries are Mongoose subdocuments.
  return (booking.tdartsSync ?? []).map((e) => ({
    participantKey: e.participantKey,
    tournamentCode: e.tournamentCode,
    status: e.status as StoredSyncEntry["status"],
    playerId: e.playerId ?? null,
    rosterStatus: e.rosterStatus ?? null,
    error: e.error ?? null,
    syncedAt: e.syncedAt ?? null,
  }));
}

export interface TDartsTeamResyncResult {
  /** Team tickets whose tDarts entry now matches the booking. */
  amended: number;
  /** Team tickets tDarts refused or could not be reached for — details are on `booking.tdartsSync[].error`. */
  failed: number;
}

/**
 * Pushes an edited roster to tDarts for every team ticket (3+ players) of the
 * booking that is already enrolled there. A ticket that never made it to
 * tDarts is enrolled now. Never throws: the outcome is recorded per ticket.
 *
 * Solo and pair tickets are left alone — tDarts cannot amend those yet.
 */
export async function resyncBookingTeamsToTDarts(bookingId: string, opts?: { fetchImpl?: FetchLike }): Promise<TDartsTeamResyncResult> {
  const context = await loadSyncContext(bookingId, "team resync");
  if (!context || !context.isTeamEvent || context.isPairEvent) return { amended: 0, failed: 0 };
  const { booking, tournamentCode, creds } = context;

  const entries = storedEntries(booking);
  const buyer = { name: booking.customer.name, email: booking.customer.email };
  let amended = 0;
  let failed = 0;

  for (const [index, attendee] of (booking.attendees ?? []).entries()) {
    const key = `${index}`;
    const at = entries.findIndex((e) => e.participantKey === key);
    const current = at >= 0 ? entries[at]! : entry(key, tournamentCode, { status: "failed" });
    if (current.status === "withdrawn") continue;

    const roster = buildTDartsTeamRoster(booking.attendeeFieldSchema ?? [], attendee.fields, booking.teamMemberFieldSchema ?? [], attendee.members ?? [], buyer);
    let next: StoredSyncEntry;
    if (!roster.ok) {
      next = { ...current, error: roster.error };
      failed += 1;
    } else {
      const orderId = `${bookingId}:${key}`;
      try {
        if (current.playerId) {
          await updateTDartsTeam(creds, { tournamentCode, orderId, teamName: roster.teamName, members: roster.members }, opts?.fetchImpl);
          next = { ...current, error: null, syncedAt: new Date() };
        } else {
          const enrolled = await enrollTDartsTeam(
            creds,
            { tournamentCode, teamName: roster.teamName, members: roster.members, orderId, amount: booking.totalHuf, currency: booking.currency, paidAt: booking.paidAt?.toISOString() },
            opts?.fetchImpl,
          );
          next = entry(key, tournamentCode, { status: enrolled.rosterStatus === "waiting" ? "waiting" : "synced", playerId: enrolled.teamPlayerId, rosterStatus: enrolled.rosterStatus, syncedAt: new Date() });
        }
        amended += 1;
      } catch (error) {
        // The tDarts entry is unchanged and still valid — keep its status, record why the edit did not land.
        next = { ...current, error: describeTDartsError(error, "tDarts team update failed") };
        failed += 1;
      }
    }
    if (at >= 0) entries[at] = next;
    else entries.push(next);
  }

  await bookingRepository.updateById(bookingId, { tdartsSync: entries as unknown as IBooking["tdartsSync"] });
  return { amended, failed };
}

export interface TDartsWithdrawResult {
  withdrawn: number;
  /** Tickets tDarts would not release (e.g. the draw is already made) — a moderator has to handle those on tdarts.hu. */
  failed: number;
}

/**
 * Cancellation / refund: takes the booking's team tickets off the tDarts
 * tournament so the place goes to the waiting list. Never throws. Solo and
 * pair tickets cannot be withdrawn through the partner API yet and are left
 * as they are.
 */
export async function withdrawBookingFromTDarts(bookingId: string, opts?: { fetchImpl?: FetchLike }): Promise<TDartsWithdrawResult> {
  const context = await loadSyncContext(bookingId, "withdraw");
  if (!context || !context.isTeamEvent || context.isPairEvent) return { withdrawn: 0, failed: 0 };
  const { booking, tournamentCode, creds } = context;

  const entries = storedEntries(booking);
  let withdrawn = 0;
  let failed = 0;
  for (const [at, current] of entries.entries()) {
    if (!current.playerId || current.status === "withdrawn") continue;
    try {
      await withdrawTDartsTeam(creds, { tournamentCode, orderId: `${bookingId}:${current.participantKey}` }, opts?.fetchImpl);
      entries[at] = { ...current, status: "withdrawn", rosterStatus: null, error: null, syncedAt: new Date() };
      withdrawn += 1;
    } catch (error) {
      entries[at] = { ...current, error: describeTDartsError(error, "tDarts withdraw failed") };
      failed += 1;
    }
  }
  if (withdrawn + failed > 0) {
    await bookingRepository.updateById(bookingId, { tdartsSync: entries as unknown as IBooking["tdartsSync"] });
  }
  return { withdrawn, failed };
}

/** Registered into checkout-service's AFTER_BOOKING_PAID_HOOKS below. syncBookingToTDarts already no-ops when the event/org isn't tDarts-configured. */
export async function tdartsAfterBookingPaidHook(booking: IBooking): Promise<void> {
  if (booking.isTest) return;
  await syncBookingToTDarts(String(booking._id));
}

AFTER_BOOKING_PAID_HOOKS.push(tdartsAfterBookingPaidHook);
