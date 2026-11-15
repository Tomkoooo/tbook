/**
 * Pacing of manual sends: batches of N messages, a pause of P seconds
 * between batches, and a longer back-off when the SMTP provider throttles.
 * Pure helpers, so they can be unit tested without a database.
 */

export const DEFAULT_SEND_BATCH_SIZE = 50;
export const MIN_SEND_BATCH_SIZE = 1;
export const MAX_SEND_BATCH_SIZE = 1000;
export const DEFAULT_SEND_BATCH_PAUSE_SECONDS = 60;
export const MIN_SEND_BATCH_PAUSE_SECONDS = 0;
export const MAX_SEND_BATCH_PAUSE_SECONDS = 3600;
/** Throttling back-off: at least this long, doubled per throttle in a row, never longer than the cap. */
export const MIN_THROTTLE_PAUSE_SECONDS = 30;
export const MAX_THROTTLE_PAUSE_SECONDS = 15 * 60;
/** A recipient refused temporarily this many times in one run is logged as failed. */
export const MAX_TEMPORARY_ATTEMPTS = 5;
/** This many throttle pauses in a row without a single delivery: the run stops (the provider is down). */
export const MAX_CONSECUTIVE_THROTTLES = 12;

export interface SendBatchSettings {
  batchSize: number;
  batchPauseSeconds: number;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const text = typeof raw === "number" ? String(raw) : String(raw ?? "").trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Reads `sendBatchSize` / `sendBatchPauseSeconds` from the module config (strings from the console), clamped to sane bounds. */
export function sendBatchSettings(config: { sendBatchSize?: unknown; sendBatchPauseSeconds?: unknown } | null | undefined): SendBatchSettings {
  return {
    batchSize: clampInt(config?.sendBatchSize, DEFAULT_SEND_BATCH_SIZE, MIN_SEND_BATCH_SIZE, MAX_SEND_BATCH_SIZE),
    batchPauseSeconds: clampInt(config?.sendBatchPauseSeconds, DEFAULT_SEND_BATCH_PAUSE_SECONDS, MIN_SEND_BATCH_PAUSE_SECONDS, MAX_SEND_BATCH_PAUSE_SECONDS),
  };
}

/** The pause after the `level`-th throttle in a row (1 = first): double the batch pause per level, capped. */
export function throttlePauseSeconds(batchPauseSeconds: number, level: number): number {
  const base = Math.max(batchPauseSeconds, MIN_THROTTLE_PAUSE_SECONDS);
  return Math.min(MAX_THROTTLE_PAUSE_SECONDS, base * 2 ** Math.max(1, level));
}

const TEMPORARY_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETLS"]);

/**
 * True for a failure worth retrying later: an SMTP 4xx reply (421 too many
 * connections, 450/451/452 try again later…) or a connection-level error.
 * 5xx replies and everything else (no address, no SMTP config) are permanent.
 */
export function isTemporaryMailError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { responseCode?: unknown; code?: unknown; message?: unknown };
  const responseCode = Number(err.responseCode);
  if (Number.isFinite(responseCode) && responseCode >= 400) return responseCode < 500;
  if (typeof err.code === "string" && TEMPORARY_CODES.has(err.code)) return true;
  const message = typeof err.message === "string" ? err.message : "";
  return /^\s*4\d\d[\s-]/.test(message) || /\b4\d\d\b.*(too many|try again|temporar|rate limit|throttl)/i.test(message);
}
