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

/** Reads the key from the X-TBook-Api-Key header, falling back to `Authorization: Bearer <key>`. */
export function extractApiKeyFromRequest(request: Request): string | null {
  const header = request.headers.get(TBOOK_API_KEY_HEADER);
  if (header?.trim()) return header.trim();
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  return null;
}

// ---- Dev preview key ----------------------------------------------------------

export const TBOOK_PREVIEW_KEY_PREFIX = "tbp_";
export const TBOOK_PREVIEW_HEADER = "x-tbook-preview";

/** A new preview key (plaintext; stored as a hash plus an encrypted copy). */
export function generatePreviewKey(): string {
  return `${TBOOK_PREVIEW_KEY_PREFIX}${randomBytes(18).toString("hex")}`;
}

/** The `X-TBook-Preview` header value, normalized like an API key; null when absent. */
export function extractPreviewKeyFromRequest(request: Request): string | null {
  const value = normalizeTBookApiKey(request.headers.get(TBOOK_PREVIEW_HEADER));
  return value || null;
}

/** True when `plaintext` is the group's current preview key (constant-time). */
export function verifyPreviewKey(plaintext: string | null | undefined, group: { previewKeyHash?: string | null } | null | undefined): boolean {
  if (!plaintext || !group?.previewKeyHash) return false;
  return verifyApiKey(plaintext, group.previewKeyHash);
}
