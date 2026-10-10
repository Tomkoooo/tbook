import crypto from "node:crypto";
import { decryptOrgSecret } from "./org-secrets";

/**
 * The tDarts partner API as tbook calls it: credentials, request signing and
 * one function per endpoint. No booking knowledge here — that is
 * tdarts-sync-service.ts.
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

type PartnerFetchResult = { ok: true; data: unknown } | { ok: false; status: number; error: string; code: string | null };

/**
 * A refusal from the tDarts partner API. `code` is tDarts' stable reason
 * (e.g. `DRAW_ALREADY_MADE`, `PLAYER_ALREADY_PLAYED`) when it sent one —
 * branch on that, never on the message.
 */
export class TDartsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "TDartsApiError";
  }
}

function fail(result: Extract<PartnerFetchResult, { ok: false }>): never {
  throw new TDartsApiError(result.error, result.status, result.code);
}

async function partnerFetch(
  creds: TDartsCredentials,
  path: string,
  init: { method: "GET" | "POST" | "PATCH"; body?: unknown; idempotencyKey?: string },
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
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Network error", code: null };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const message = json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error) : `tDarts API ${res.status}`;
    const code = json && typeof json === "object" && "code" in json ? String((json as { code: unknown }).code) : null;
    return { ok: false, status: res.status, error: message, code };
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
  if (!result.ok) fail(result);
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
  if (!result.ok) fail(result);
  const data = result.data as { pairPlayerId: string; rosterStatus: "applied" | "waiting" };
  return { pairPlayerId: data.pairPlayerId, rosterStatus: data.rosterStatus };
}

// ---------------------------------------------------------------------------
// Teams (3+ players per ticket) — tDarts `team` participation mode.
// ---------------------------------------------------------------------------

/** `email` is optional: a member without one becomes a guest player on tDarts (no account). */
export interface TDartsTeamMember {
  name: string;
  email?: string;
  country?: string;
  birthDate?: string;
}

export interface TDartsEnrollTeamResult {
  teamPlayerId: string;
  rosterStatus: "applied" | "waiting";
}

/**
 * One call enrolls the whole team as a single entrant. The first member is the
 * booking contact and must have an email. Idempotent on (clientId, orderId) —
 * `orderId` must be unique per team ticket.
 */
export async function enrollTDartsTeam(
  creds: TDartsCredentials,
  input: { tournamentCode: string; teamName: string; members: TDartsTeamMember[]; orderId: string; amount?: number; currency?: string; paidAt?: string },
  fetchImpl?: FetchLike,
): Promise<TDartsEnrollTeamResult> {
  const { tournamentCode, ...body } = input;
  const result = await partnerFetch(creds, `/partner/tournaments/${tournamentCode}/enroll-team`, { method: "POST", body, idempotencyKey: input.orderId }, fetchImpl);
  if (!result.ok) fail(result);
  const data = result.data as { teamPlayerId: string; rosterStatus: "applied" | "waiting" };
  return { teamPlayerId: data.teamPlayerId, rosterStatus: data.rosterStatus };
}

export interface TDartsUpdateTeamResult {
  updated: Array<"teamName" | "members">;
}

/**
 * Amends an enrolled team: `members` is the whole roster afterwards. tDarts
 * refuses to remove a player who already played (`PLAYER_ALREADY_PLAYED`) or
 * the captain (`PLAYER_IS_CAPTAIN`); adding is allowed during the event.
 * `orderId` goes in the body too — the signature covers the body, not the path.
 */
export async function updateTDartsTeam(
  creds: TDartsCredentials,
  input: { tournamentCode: string; orderId: string; teamName?: string; members?: TDartsTeamMember[] },
  fetchImpl?: FetchLike,
): Promise<TDartsUpdateTeamResult> {
  const { tournamentCode, ...body } = input;
  const path = `/partner/tournaments/${tournamentCode}/enrollments/${encodeURIComponent(input.orderId)}`;
  const result = await partnerFetch(creds, path, { method: "PATCH", body, idempotencyKey: input.orderId }, fetchImpl);
  if (!result.ok) fail(result);
  return { updated: (result.data as { updated?: Array<"teamName" | "members"> }).updated ?? [] };
}

export interface TDartsWithdrawTeamResult {
  /** False when tDarts had already withdrawn it — the call is safe to repeat. */
  withdrawnNow: boolean;
}

/** Frees the team's place (only before the draw — `DRAW_ALREADY_MADE` afterwards). The orderId is spent: a re-booking needs a new one. */
export async function withdrawTDartsTeam(
  creds: TDartsCredentials,
  input: { tournamentCode: string; orderId: string },
  fetchImpl?: FetchLike,
): Promise<TDartsWithdrawTeamResult> {
  const path = `/partner/tournaments/${input.tournamentCode}/enrollments/${encodeURIComponent(input.orderId)}/withdraw`;
  const result = await partnerFetch(creds, path, { method: "POST", body: { orderId: input.orderId }, idempotencyKey: input.orderId }, fetchImpl);
  if (!result.ok) fail(result);
  return { withdrawnNow: Boolean((result.data as { withdrawnNow?: boolean }).withdrawnNow) };
}
