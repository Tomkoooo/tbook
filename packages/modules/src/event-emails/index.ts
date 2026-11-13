import { extensions, registerModule } from "@tbook/services";
import { EVENT_EMAILS, hasAutomaticConfirmation, sendAutomaticEmailsAfterEdit, sendAutomaticEmailsForBooking } from "./service";

/**
 * Event emails: per-event templates with placeholders (attendee answers,
 * registration number, inline QR code, module values like the bus details),
 * sent automatically on registration — one per attendee, optionally only to
 * attendees matching a rule — or manually with a Send button to registered
 * attendees or to a data list (everyone, or only those not registered yet).
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
