import crypto from "node:crypto";

/**
 * Ported from the legacy plugin's lib/org-secrets.ts — AES-256-GCM envelope
 * for organization-scoped secrets (Stripe/SMTP/Számlázz.hu/tDarts keys).
 * Format: `enc:v1:<iv>.<tag>.<ciphertext>` (base64url segments).
 */

const PREFIX = "enc:v1:";

/** All materials that may have been used historically to encrypt org secrets. */
function candidateKeyMaterials(): string[] {
  const raw = [process.env.TBOOK_ORG_SECRETS_KEY, process.env.AUTH_SECRET, "tbook-org-secrets-dev-key"];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const trimmed = item?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function keyBufferFromMaterial(material: string): Buffer {
  return crypto.createHash("sha256").update(material).digest();
}

/** Primary key used for new writes (prefer a dedicated org secrets key). */
function encryptionKey(): Buffer {
  const materials = candidateKeyMaterials();
  return keyBufferFromMaterial(materials[0] || "tbook-org-secrets-dev-key");
}

/** Encrypt a secret for storage on the organization document. */
export function encryptOrgSecret(plain: string): string {
  const value = plain.trim();
  if (!value) return "";
  if (value.startsWith(PREFIX)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptWithKeyBuffer(stored: string, key: Buffer): string | null {
  const payload = stored.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Decrypt an org secret. Tries every configured key material so secrets
 * survive AUTH_SECRET / TBOOK_ORG_SECRETS_KEY rotations without forcing a
 * re-save.
 */
export function decryptOrgSecret(stored: string | null | undefined): string {
  const value = String(stored ?? "").trim();
  if (!value) return "";
  if (!value.startsWith(PREFIX)) return value;

  for (const material of candidateKeyMaterials()) {
    const plain = decryptWithKeyBuffer(value, keyBufferFromMaterial(material));
    if (plain != null) return plain;
  }

  console.warn("[tbook] failed to decrypt org secret with any known key — re-save the value in org settings (encryption key mismatch).");
  return "";
}

/** Ciphertext is stored but cannot be read with the current TBOOK_ORG_SECRETS_KEY / AUTH_SECRET. */
export function orgSecretLooksEncrypted(stored: string | null | undefined): boolean {
  return String(stored ?? "").trim().startsWith(PREFIX);
}

/** Mask for admin UI — never return full secrets to the client. */
export function maskSecret(stored: string | null | undefined): { configured: boolean; hint: string } {
  const plain = decryptOrgSecret(stored);
  if (!plain) return { configured: false, hint: "" };
  if (plain.length <= 8) return { configured: true, hint: "••••••••" };
  return { configured: true, hint: `${plain.slice(0, 4)}…${plain.slice(-4)}` };
}
