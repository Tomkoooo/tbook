import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Ported from the legacy plugin's lib/api-key.ts — event-group public API key handling. */

export const TBOOK_API_KEY_PREFIX = "tbk_";
export const TBOOK_API_KEY_HEADER = "x-tbook-api-key";

/**
 * Browser `fetch` headers must be ISO-8859-1 — pasted keys often include
 * BOM, spaces, or invisible Unicode from copy/paste. Strip those before
 * sending as a header value.
 */
export function normalizeTBookApiKey(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

export function isValidTBookApiKeyFormat(key: string): boolean {
  const normalized = normalizeTBookApiKey(key);
  return normalized.startsWith(TBOOK_API_KEY_PREFIX) && normalized.length > TBOOK_API_KEY_PREFIX.length + 8;
}

/** Generates a new plaintext API key (shown to the admin once). */
export function generateApiKey(): string {
  return `${TBOOK_API_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
}

/** Only the SHA-256 hash is persisted — a leaked DB dump never exposes keys. */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Non-secret hint for the admin list, e.g. `tbk_ab12…89ef`. */
export function apiKeyHint(plaintext: string): string {
  return `${plaintext.slice(0, 8)}…${plaintext.slice(-4)}`;
}

export function verifyApiKey(plaintext: string, storedHash: string): boolean {
  if (!plaintext || !storedHash) return false;
  const a = Buffer.from(hashApiKey(plaintext), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
