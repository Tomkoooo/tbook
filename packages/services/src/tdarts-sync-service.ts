import crypto from "node:crypto";
import { bookingRepository, eventRepository, organizationRepository, type IBooking } from "@tbook/db";
import type { AttendeeFieldDef, AttendeeFieldValue } from "@tbook/schemas";
import { AFTER_BOOKING_PAID_HOOKS } from "./checkout-service";
import { decryptOrgSecret } from "./org-secrets";

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

// ---------------------------------------------------------------------------
// Credentials + signed partner requests.
// ---------------------------------------------------------------------------

export interface TDartsCredentials {
  apiBaseUrl: string;
  partnerClientId: string;
  partnerClientSecret: string;
}

export interface OrgTDartsSettingsLike {
  enabled: boolean;
  apiBaseUrl: string;
  partnerClientId: string;
  partnerClientSecretEnc: string;
}

export function resolveTDartsCredentials(settings: OrgTDartsSettingsLike | null | undefined): TDartsCredentials | null {
  if (!settings?.enabled) return null;
  const apiBaseUrl = settings.apiBaseUrl?.trim().replace(/\/+$/, "");
  const partnerClientId = settings.partnerClientId?.trim();
  const partnerClientSecret = decryptOrgSecret(settings.partnerClientSecretEnc);
  if (!apiBaseUrl || !partnerClientId || !partnerClientSecret) return null;
  return { apiBaseUrl, partnerClientId, partnerClientSecret };
}

/** HMAC-SHA256 over `${timestamp}.${rawBody}`, keyed by the partner client secret — must match the real tDarts partner API exactly. */
export function signTDartsRequest(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type PartnerFetchResult = { ok: true; data: unknown } | { ok: false; status: number; error: string };

async function partnerFetch(
  creds: TDartsCredentials,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string },
  fetchImpl: FetchLike = fetch,
): Promise<PartnerFetchResult> {
  const rawBody = init.body !== undefined ? JSON.stringify(init.body) : "";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signTDartsRequest(creds.partnerClientSecret, timestamp, rawBody);

  const headers: Record<string, string> = {
    "X-Client-Id": creds.partnerClientId,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  let res: Response;
  try {
    res = await fetchImpl(`${creds.apiBaseUrl}${path}`, { method: init.method, headers, body: init.body !== undefined ? rawBody : undefined });
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Network error" };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const message = json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error) : `tDarts API ${res.status}`;
    return { ok: false, status: res.status, error: message };
  }
  return { ok: true, data: json };
}

export interface TDartsEnrollResult {
  playerId: string;
  rosterStatus: "applied" | "waiting";
}

/** Idempotent on (clientId, orderId) — safe to retry. */
export async function enrollTDartsPlayer(
  creds: TDartsCredentials,
  input: { tournamentCode: string; email: string; name: string; country?: string; birthDate?: string; orderId: string; amount?: number; currency?: string; paidAt?: string },
  fetchImpl?: FetchLike,
): Promise<TDartsEnrollResult> {
  const { tournamentCode, orderId, ...body } = input;
  const result = await partnerFetch(creds, `/partner/tournaments/${tournamentCode}/enroll`, { method: "POST", body, idempotencyKey: orderId }, fetchImpl);
  if (!result.ok) throw new Error(result.error);
  const data = result.data as { playerId: string; rosterStatus: "applied" | "waiting" };
  return { playerId: data.playerId, rosterStatus: data.rosterStatus };
}

export interface TDartsEnrollPairResult {
  pairPlayerId: string;
  rosterStatus: "applied" | "waiting";
}

/** One call registers both members as a single roster unit — orderId must be unique per pair, not per member. */
export async function enrollTDartsPair(
  creds: TDartsCredentials,
  input: {
    tournamentCode: string;
    member1: { email: string; name: string; country?: string; birthDate?: string };
    member2: { email: string; name: string; country?: string; birthDate?: string };
    orderId: string;
    amount?: number;
    currency?: string;
    paidAt?: string;
  },
  fetchImpl?: FetchLike,
): Promise<TDartsEnrollPairResult> {
  const { tournamentCode, member1, member2, orderId, ...rest } = input;
  const body = { email: member1.email, name: member1.name, country: member1.country, birthDate: member1.birthDate, partner: member2, ...rest };
  const result = await partnerFetch(creds, `/partner/tournaments/${tournamentCode}/enroll`, { method: "POST", body, idempotencyKey: orderId }, fetchImpl);
  if (!result.ok) throw new Error(result.error);
  const data = result.data as { pairPlayerId: string; rosterStatus: "applied" | "waiting" };
  return { pairPlayerId: data.pairPlayerId, rosterStatus: data.rosterStatus };
}

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
// Orchestration — three enrollment strategies keyed off registrationUnit/playersPerTicket.
// ---------------------------------------------------------------------------

export type TDartsSyncEntryResult = {
  participantKey: string;
  tournamentCode: string;
  status: "synced" | "waiting" | "failed" | "skipped";
  playerId: string | null;
  rosterStatus: "applied" | "waiting" | null;
  error: string | null;
  syncedAt: Date | null;
};

function entry(participantKey: string, tournamentCode: string, patch: Partial<TDartsSyncEntryResult>): TDartsSyncEntryResult {
  return { participantKey, tournamentCode, status: "failed", playerId: null, rosterStatus: null, error: null, syncedAt: null, ...patch };
}

/**
 * `person` (solo) → one enroll call per attendee. `team` with exactly 2
 * roster slots (doubles/pairs) → one pair-enroll call per ticket. `team`
 * with 3+ roster slots → tDarts' partner API has no team-roster concept;
 * these are marked `skipped`, never sent to tDarts (moderators manage those
 * rosters directly on tdarts.hu).
 */
export async function syncBookingToTDarts(bookingId: string, opts?: { fetchImpl?: FetchLike }): Promise<void> {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) return;

  const event = await eventRepository.findById(String(booking.eventId));
  const tournamentCode = event?.tdarts?.enabled ? event.tdarts.tournamentCode : null;
  if (!tournamentCode) return;

  const org = booking.organizationId ? await organizationRepository.findById(String(booking.organizationId)) : null;
  const creds = resolveTDartsCredentials(org?.settings?.tdarts ?? null);
  if (!creds) {
    console.warn(`[tbook] tDarts sync skipped for booking ${bookingId} — organization has no tDarts partner credentials configured`);
    return;
  }

  const isTeamEvent = event?.registrationUnit === "team";
  const isPairEvent = isTeamEvent && event?.teamMemberLimit === 2;
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

  if (attendees.length === 0) {
    if (!isTeamEvent && booking.guests === 1) await syncSolo("0", undefined);
  } else if (isTeamEvent && !isPairEvent) {
    attendees.forEach((_, ai) => {
      results.push(entry(`${ai}`, tournamentCode!, { status: "skipped", error: "Team tournaments with more than 2 roster slots are not auto-synced to tDarts — managed directly on tdarts.hu." }));
    });
  } else if (isPairEvent) {
    await Promise.all(attendees.map((a, ai) => syncPair(`${ai}`, a.members ?? [])));
  } else {
    await Promise.all(attendees.map((a, ai) => syncSolo(`${ai}`, a.fields)));
  }

  if (results.length > 0) {
    await bookingRepository.updateById(bookingId, { tdartsSync: results as unknown as IBooking["tdartsSync"] });
  }
}

/** Registered into checkout-service's AFTER_BOOKING_PAID_HOOKS below. syncBookingToTDarts already no-ops when the event/org isn't tDarts-configured. */
export async function tdartsAfterBookingPaidHook(booking: IBooking): Promise<void> {
  await syncBookingToTDarts(String(booking._id));
}

AFTER_BOOKING_PAID_HOOKS.push(tdartsAfterBookingPaidHook);
