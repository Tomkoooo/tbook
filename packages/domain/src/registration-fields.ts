import type { AttendeeFieldDef, AttendeeFieldValue, DataListKeyNormalization } from "@tbook/schemas";

/**
 * Pure helpers behind the registration form builder's newer capabilities:
 * conditional fields (`showWhen`), checkbox values, unique/identifier value
 * normalization, data-list key matching and registration numbers.
 */

/** Values a ticked checkbox may arrive as (forms, JSON, spreadsheets). */
const TRUTHY_CHECKBOX = new Set(["true", "1", "yes", "on", "igen", "x"]);

export function isCheckboxChecked(raw: AttendeeFieldValue | boolean | null | undefined): boolean {
  if (raw === true) return true;
  if (raw == null || raw === false) return false;
  return TRUTHY_CHECKBOX.has(String(raw).trim().toLowerCase());
}

/**
 * Whether a field is asked, given the attendee's other answers. A field
 * without `showWhen` is always shown; a condition on a missing field hides it.
 */
export function isFieldVisible(field: Pick<AttendeeFieldDef, "showWhen">, fields: Record<string, AttendeeFieldValue | undefined>): boolean {
  const condition = field.showWhen;
  if (!condition || !condition.fieldKey) return true;
  const raw = fields[condition.fieldKey];
  if (raw == null || raw === "") return false;
  const value = String(raw).trim().toLowerCase();
  if (condition.values.length === 0) return true;
  return condition.values.some((expected) => expected.trim().toLowerCase() === value);
}

/** Normalises a list key or a submitted value so the two compare equal. */
export function normalizeListKey(raw: unknown, mode: DataListKeyNormalization = "trim_case"): string {
  if (raw == null) return "";
  // Spreadsheet numbers arrive as 60000001 or "60000001.0"; keep the integer.
  let text = typeof raw === "number" ? (Number.isInteger(raw) ? String(raw) : String(raw)) : String(raw);
  text = text.trim();
  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");
  switch (mode) {
    case "digits_only":
      return text.replace(/\D+/g, "");
    case "alnum":
      return text.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
    default:
      return text.replace(/\s+/g, " ").toLowerCase();
  }
}

/** How a `unique` field's value is compared: case-, space- and dash-insensitive. */
export function normalizeUniqueValue(raw: AttendeeFieldValue | null | undefined): string {
  if (raw == null) return "";
  return String(raw).trim().replace(/[\s-]+/g, "").toLowerCase();
}

/** Crockford base32 without I, L, O, U — nothing that reads as another character. */
const REGISTRATION_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * An 8-character registration number shown as "XXXX-XXXX". Random, not
 * sequential, so one can't be guessed from another. `randomBytes` must hold
 * at least 8 bytes (injected so this stays pure and testable).
 */
export function formatRegistrationNumber(randomBytes: Uint8Array): string {
  if (randomBytes.length < 8) throw new Error("formatRegistrationNumber needs 8 random bytes");
  let code = "";
  for (let i = 0; i < 8; i += 1) code += REGISTRATION_ALPHABET[randomBytes[i]! % 32];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Canonical form for matching a typed registration number: upper case,
 * separators dropped, and the look-alikes Crockford maps (O→0, I/L→1).
 * Returns "" when the input can't be one.
 */
export function normalizeRegistrationNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const compact = raw.toUpperCase().replace(/[\s-]+/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(compact)) return "";
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}
