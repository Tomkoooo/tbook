import type { SystemEmailTrigger } from "./model";
import { ATTENDEE_PLACEHOLDERS, type PlaceholderInfo } from "./render";

/**
 * The messages modules send to a guest on their own (not on registration,
 * not by pressing Send). Each can be given an event template with the
 * system trigger; see `sendSystemEmail` in service.ts for the precedence.
 */
export interface SystemEmailInfo {
  trigger: SystemEmailTrigger;
  /** Short label for lists. */
  label: string;
  /** When it goes out, for organizers. */
  when: string;
  /** The module that sends it (the row is shown only while it is on for the event). */
  moduleKey: string;
  /** Who gets it: the waitlist entry's contact, or each affected attendee of a booking. */
  recipient: "waitlist_contact" | "attendee";
  /** Placeholders on top of the general ones. */
  extra: PlaceholderInfo[];
  /** Registration answers and module values ({{field.*}}, {{bus.*}}) are available. */
  answers: boolean;
  /** {{qrCode}} makes sense (an active registration with a ticket). */
  qr: boolean;
}

const ALIASES: PlaceholderInfo[] = [
  { key: "name", label: "Full name (same as fullName)", sample: "Teszt Elek" },
  { key: "event", label: "Event name (same as eventName)", sample: "MVM Hálózatok Ünnepe 2026" },
];

export const SYSTEM_EMAILS: SystemEmailInfo[] = [
  {
    trigger: "waitlist_joined",
    label: "Waitlist: joined",
    when: "When someone joins the waitlist of the full event. Goes to the contact address of the waitlist entry.",
    moduleKey: "waitlist",
    recipient: "waitlist_contact",
    extra: [{ key: "position", label: "Place in line (1 = next)", sample: "3" }],
    answers: true,
    qr: false,
  },
  {
    trigger: "waitlist_offer",
    label: "Waitlist: place offered",
    when: "Waitlist mode “offer”: a place freed up and is held for the first in line for a few hours. Must contain {{link}} (the booking link).",
    moduleKey: "waitlist",
    recipient: "waitlist_contact",
    extra: [
      { key: "link", label: "Link to take the place", sample: "https://tbook.example.hu/waitlist/abc123" },
      { key: "hours", label: "Hours the place is held", sample: "48" },
    ],
    answers: true,
    qr: false,
  },
  {
    trigger: "waitlist_registered",
    label: "Waitlist: registered automatically",
    when: "Waitlist mode “auto”: a place freed up and the first in line was registered. The usual registration confirmation goes out as well.",
    moduleKey: "waitlist",
    recipient: "waitlist_contact",
    extra: [
      { key: "registrationNumber", label: "Registration number", sample: "7K3M-9QX2" },
      { key: "busNote", label: "Note when the chosen bus was full by then (added at the end if not used)", sample: "Fontos: a választott buszjáraton időközben elfogytak a helyek…" },
    ],
    answers: true,
    qr: false,
  },
  {
    trigger: "bus_seat_freed",
    label: "Bus waitlist: seat freed",
    when: "A bus seat freed up: each guest who asked to be notified (bus answer “waitlist”) gets it, so they can pick a bus on the website.",
    moduleKey: "bus-transport",
    recipient: "attendee",
    extra: [],
    answers: true,
    qr: false,
  },
  {
    trigger: "booking_cancelled",
    label: "Registration cancelled",
    when: "A guest's registration was cancelled — by the guest on the website or by an organizer. One per cancelled guest.",
    moduleKey: "guest-portal",
    recipient: "attendee",
    extra: [],
    answers: true,
    qr: false,
  },
];

export function systemEmailInfo(trigger: SystemEmailTrigger): SystemEmailInfo {
  return SYSTEM_EMAILS.find((info) => info.trigger === trigger)!;
}

/** The general placeholders of a system email (answers and module values come on top, when `answers`). */
export function systemEmailPlaceholders(trigger: SystemEmailTrigger): PlaceholderInfo[] {
  const info = systemEmailInfo(trigger);
  const waitlist = info.recipient === "waitlist_contact";
  const base = ATTENDEE_PLACEHOLDERS.filter((p) => (p.key !== "qrCode" || info.qr) && (!waitlist || p.key !== "registrationNumber"));
  return [...base, ...ALIASES, ...info.extra];
}

/** Sample values of the trigger's own placeholders (test sends). */
export function systemEmailSampleValues(trigger: SystemEmailTrigger): Record<string, string> {
  return Object.fromEntries(systemEmailInfo(trigger).extra.map((p) => [p.key, p.sample]));
}

/**
 * A default plain text (paragraphs, line breaks, {{siteUrl}} / {{link}})
 * as editor HTML, so "customise" starts from exactly what is sent today.
 */
export function plainTextToTemplateHtml(text: string): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) =>
      `<p>${escape(paragraph)
        .replace(/\n/g, "<br>")
        .replace(/\{\{\s*(siteUrl|link)\s*\}\}/g, (_, key: string) => `<a href="{{${key}}}">{{${key}}}</a>`)
        .replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)}</p>`,
    )
    .join("");
}
