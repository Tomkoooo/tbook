import { extensions, registerModule } from "@tbook/services";
import {
  DEFAULT_SEND_BATCH_PAUSE_SECONDS,
  DEFAULT_SEND_BATCH_SIZE,
  MAX_SEND_BATCH_PAUSE_SECONDS,
  MAX_SEND_BATCH_SIZE,
  MIN_SEND_BATCH_PAUSE_SECONDS,
  MIN_SEND_BATCH_SIZE,
} from "./batching";
import { EVENT_EMAILS, hasAutomaticConfirmation, sendAutomaticEmailsAfterEdit, sendAutomaticEmailsForBooking } from "./service";

/**
 * Event emails: per-event templates with placeholders (attendee answers,
 * registration number, inline QR code, module values like the bus details),
 * sent automatically on registration — one per attendee, optionally only to
 * attendees matching a rule — or manually with a Send button to registered
 * attendees or to a data list (everyone, or only those not registered yet).
 * Manual sends go out in batches with a pause between them, back off when
 * the SMTP server throttles, and continue on their own after a restart
 * (`startEventEmailResumeScheduler`, started by the web app's instrumentation).
 * Every delivery is logged with its error, if any.
 */
export function registerEventEmailsModule(): void {
  registerModule({
    key: EVENT_EMAILS,
    name: "Event emails",
    description: "Per-attendee confirmation emails with QR code, conditional emails, and campaign/reminder sends with a delivery log.",
    scopes: ["org", "group", "event"],
    configFields: [
      { key: "siteUrl", label: "Event website", type: "url", hint: "Linked from every email as {{siteUrl}}." },
      { key: "surveyUrl", label: "Survey link", type: "url", hint: "{{surveyUrl}} — e.g. in the thank-you email." },
      { key: "galleryUrl", label: "Photo gallery link", type: "url", hint: "{{galleryUrl}} — e.g. in the thank-you email." },
      {
        key: "nameOrder",
        label: "Name order",
        type: "select",
        hint: "Which part of the name {{firstName}} greets.",
        options: [
          { value: "family_first", label: "Family name first (Hungarian)" },
          { value: "given_first", label: "Given name first" },
        ],
      },
      {
        key: "sendBatchSize",
        label: "Send batch size",
        type: "text",
        hint: `Manual sends go out in batches of this many messages (default ${DEFAULT_SEND_BATCH_SIZE}, ${MIN_SEND_BATCH_SIZE}–${MAX_SEND_BATCH_SIZE}).`,
      },
      {
        key: "sendBatchPauseSeconds",
        label: "Pause between batches (seconds)",
        type: "text",
        hint: `Wait this long after each batch (default ${DEFAULT_SEND_BATCH_PAUSE_SECONDS}, ${MIN_SEND_BATCH_PAUSE_SECONDS}–${MAX_SEND_BATCH_PAUSE_SECONDS}). Doubled (up to 15 min) while the SMTP server throttles.`,
      },
    ],
  });

  extensions.onBookingConfirmed(EVENT_EMAILS, (booking) => sendAutomaticEmailsForBooking(booking));
  // A guest or organizer edit: only emails whose conditions now match and look at a changed answer (or a new address).
  extensions.onAttendeesEdited(EVENT_EMAILS, (before, after) => sendAutomaticEmailsAfterEdit(before, after));
  extensions.registerBookingEmailSuppressor(EVENT_EMAILS, (booking) => hasAutomaticConfirmation(booking));
}

export * from "./service";
export * from "./model";
export * from "./render";
export * from "./system";
export * from "./batching";
export * from "./scheduler";
