/**
 * The single customer email sent when a booking is paid: confirmation
 * text, with the ticket PDF and the invoice PDF attached when they exist.
 *
 * Pure on purpose — the server renders the real mail with it and the
 * console's editor renders its live preview with the exact same code.
 */

export interface BookingEmailPlaceholder {
  key: string;
  label: string;
  /** Shown in the editor preview. */
  sample: string;
}

export const BOOKING_EMAIL_PLACEHOLDERS: readonly BookingEmailPlaceholder[] = [
  { key: "customerName", label: "Customer name", sample: "Kovács Anna" },
  { key: "eventName", label: "Event name", sample: "Hungarian Open Pairs" },
  { key: "eventDate", label: "Event date", sample: "2026. 11. 14." },
  { key: "guests", label: "Number of entries", sample: "2" },
  { key: "total", label: "Total paid", sample: "10 000 HUF" },
  { key: "bookingId", label: "Booking reference", sample: "6adca367b144cc92e1561c1f" },
  { key: "organizationName", label: "Organization name", sample: "Magyar Darts Szövetség" },
  { key: "attachments", label: "Attached documents", sample: "your tickets and your invoice" },
];

export type BookingEmailValues = Partial<Record<string, string | number | null | undefined>>;

export interface BookingEmailTemplate {
  subject: string;
  /** HTML (the editor's output). */
  body: string;
}

export const DEFAULT_BOOKING_EMAIL_TEMPLATE: BookingEmailTemplate = {
  subject: "Your booking for {{eventName}}",
  body:
    "<p>Hi {{customerName}},</p>" +
    "<p>Thank you for booking <strong>{{eventName}}</strong>. Your payment of {{total}} has been received.</p>" +
    "<p>Attached you will find {{attachments}}.</p>" +
    "<p>See you there,<br>{{organizationName}}</p>",
};

/** `{{key}}`, also dotted (`{{field.employer}}`, `{{list.email}}`). */
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replaces `{{key}}` tokens. Values are HTML-escaped for the body (a
 * customer named `<b>` must not inject markup); the subject is plain text.
 * Unknown tokens are left visible so a typo is noticed rather than
 * silently swallowed.
 */
export function fillBookingEmailPlaceholders(template: string, values: BookingEmailValues, mode: "html" | "text"): string {
  return template.replace(PLACEHOLDER_PATTERN, (token, key: string) => {
    if (!(key in values)) return token;
    const raw = values[key];
    const text = raw == null ? "" : String(raw);
    return mode === "html" ? escapeHtml(text) : text;
  });
}

/** True when the editor's HTML has no visible text (e.g. an empty "<p></p>"). */
export function isBlankEmailBody(html: string | null | undefined): boolean {
  if (!html) return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

/** Picks the org's template, falling back per field to the default. */
export function resolveBookingEmailTemplate(
  ...candidates: Array<Partial<BookingEmailTemplate> | null | undefined>
): BookingEmailTemplate {
  const subject = candidates.find((c) => c?.subject?.trim())?.subject?.trim() ?? DEFAULT_BOOKING_EMAIL_TEMPLATE.subject;
  const body = candidates.find((c) => !isBlankEmailBody(c?.body))?.body ?? DEFAULT_BOOKING_EMAIL_TEMPLATE.body;
  return { subject, body };
}

export function renderBookingEmail(template: BookingEmailTemplate, values: BookingEmailValues): BookingEmailTemplate {
  return {
    subject: fillBookingEmailPlaceholders(template.subject, values, "text"),
    body: fillBookingEmailPlaceholders(template.body, values, "html"),
  };
}

/** Human phrase for {{attachments}}: "your ticket", "your 2 tickets and your invoice", … */
export function describeBookingEmailAttachments(ticketCount: number, hasInvoice: boolean): string {
  const parts: string[] = [];
  if (ticketCount === 1) parts.push("your ticket");
  else if (ticketCount > 1) parts.push(`your ${ticketCount} tickets`);
  if (hasInvoice) parts.push("your invoice");
  return parts.length > 0 ? parts.join(" and ") : "your booking details";
}

export function sampleBookingEmailValues(): BookingEmailValues {
  return Object.fromEntries(BOOKING_EMAIL_PLACEHOLDERS.map((p) => [p.key, p.sample]));
}
