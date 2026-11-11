import { fillBookingEmailPlaceholders, isCheckboxChecked, type BookingEmailValues } from "@tbook/domain";
import type { AttendeeFieldDef, AttendeeFieldValue, DataList } from "@tbook/schemas";

/**
 * Placeholders for event emails. Values are HTML-escaped when filled; the
 * one exception is {{qrCode}}, replaced by an inline image tag after the
 * escaping pass (its value is generated here, never user text).
 */

export interface PlaceholderInfo {
  key: string;
  label: string;
  sample: string;
}

export const ATTENDEE_PLACEHOLDERS: PlaceholderInfo[] = [
  { key: "firstName", label: "Given name (Keresztnév)", sample: "Elek" },
  { key: "fullName", label: "Full name", sample: "Teszt Elek" },
  { key: "registrationNumber", label: "Registration number", sample: "7K3M-9QX2" },
  { key: "qrCode", label: "QR code (image)", sample: "[QR]" },
  { key: "eventName", label: "Event name", sample: "MVM Hálózatok Ünnepe 2026" },
  { key: "eventDate", label: "Event date", sample: "2026. december 4." },
  { key: "eventTime", label: "Event time", sample: "18:00–01:00" },
  { key: "eventLocation", label: "Event location", sample: "BOK Csarnok, Budapest" },
  { key: "siteUrl", label: "Event website link", sample: "https://esemeny.example.hu" },
  { key: "surveyUrl", label: "Survey link", sample: "https://esemeny.example.hu/kerdoiv" },
  { key: "galleryUrl", label: "Photo gallery link", sample: "https://esemeny.example.hu/galeria" },
  { key: "customerName", label: "Registered by (name)", sample: "Teszt Elek" },
  { key: "customerEmail", label: "Registered by (email)", sample: "teszt.elek@example.com" },
  { key: "organizationName", label: "Organizer", sample: "Eventstructure" },
];

export const LIST_PLACEHOLDERS: PlaceholderInfo[] = [
  { key: "firstName", label: "Given name (Keresztnév)", sample: "Elek" },
  { key: "fullName", label: "Full name", sample: "Teszt Elek" },
  { key: "eventName", label: "Event name", sample: "MVM Hálózatok Ünnepe 2026" },
  { key: "eventDate", label: "Event date", sample: "2026. december 4." },
  { key: "eventTime", label: "Event time", sample: "18:00–01:00" },
  { key: "eventLocation", label: "Event location", sample: "BOK Csarnok, Budapest" },
  { key: "siteUrl", label: "Event website link", sample: "https://esemeny.example.hu" },
  { key: "surveyUrl", label: "Survey link", sample: "https://esemeny.example.hu/kerdoiv" },
  { key: "galleryUrl", label: "Photo gallery link", sample: "https://esemeny.example.hu/galeria" },
  { key: "organizationName", label: "Organizer", sample: "Eventstructure" },
];

/** `{{field.<key>}}` for every registration question, showing choice labels rather than stored values. */
export function fieldPlaceholders(schema: AttendeeFieldDef[]): PlaceholderInfo[] {
  return schema.map((field) => ({
    key: `field.${field.key}`,
    label: `Answer: ${field.label}`,
    sample: field.type === "checkbox" ? "Igen" : (field.choices?.[0]?.label ?? field.label),
  }));
}

export function listColumnPlaceholders(list: Pick<DataList, "columns"> | null): PlaceholderInfo[] {
  return (list?.columns ?? []).map((column) => ({ key: `list.${column.key}`, label: `List: ${column.label}`, sample: column.label }));
}

export function fieldDisplayValue(field: AttendeeFieldDef, raw: AttendeeFieldValue | undefined): string {
  if (field.type === "checkbox") return isCheckboxChecked(raw) ? "Igen" : "Nem";
  if (raw == null || raw === "") return "";
  if (field.type === "select") return field.choices?.find((choice) => choice.value === String(raw))?.label ?? String(raw);
  return String(raw);
}

export function fieldValues(schema: AttendeeFieldDef[], fields: Record<string, AttendeeFieldValue>): Record<string, string> {
  return Object.fromEntries(schema.map((field) => [`field.${field.key}`, fieldDisplayValue(field, fields[field.key])]));
}

export const QR_CID = "registration-qr";
const QR_TOKEN = /\{\{\s*qrCode\s*\}\}/g;

export interface RenderedEmail {
  subject: string;
  html: string;
  usesQr: boolean;
}

/** Fills placeholders; {{qrCode}} becomes an inline image when `withQr`, otherwise disappears. */
export function renderEventEmail(template: { subject: string; body: string }, values: BookingEmailValues, withQr: boolean): RenderedEmail {
  const usesQr = QR_TOKEN.test(template.body);
  QR_TOKEN.lastIndex = 0;
  const marker = "\u0000QR\u0000";
  const body = fillBookingEmailPlaceholders(template.body.replace(QR_TOKEN, marker), values, "html");
  const qrTag = withQr
    ? `<img src="cid:${QR_CID}" alt="QR" width="220" height="220" style="display:block;width:220px;height:220px;margin:12px 0" />`
    : "";
  return {
    subject: fillBookingEmailPlaceholders(template.subject, values, "text").replace(QR_TOKEN, ""),
    html: wrapEmailHtml(body.split(marker).join(qrTag)),
    usesQr,
  };
}

/** A minimal mobile-friendly frame around the editor's HTML. */
export function wrapEmailHtml(inner: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f5f5f5">' +
    '<div style="max-width:600px;margin:0 auto;padding:24px 20px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1f2937">' +
    inner +
    "</div></body></html>"
  );
}

export function sampleValues(placeholders: PlaceholderInfo[]): BookingEmailValues {
  return Object.fromEntries(placeholders.map((p) => [p.key, p.sample]));
}
