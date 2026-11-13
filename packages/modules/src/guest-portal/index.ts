import { extensions, registerModule } from "@tbook/services";
import { GUEST_PORTAL, GUEST_PORTAL_DEFAULTS, sendCancellationEmails } from "./service";

export * from "./service";

export function registerGuestPortalModule(): void {
  registerModule({
    key: GUEST_PORTAL,
    name: "Guest self-service",
    description:
      "Guests look up, change or cancel their own registration on the event website with their registration number or ID (public API: /api/v1/guest/*).",
    scopes: ["org", "group", "event"],
    configFields: [
      { key: "allowEdit", label: "Guests may change their answers", type: "select", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
      {
        key: "allowCancel",
        label: "Guests may cancel (free registrations only)",
        type: "select",
        options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
      },
      {
        key: "lockedFields",
        label: "Questions guests can't change",
        type: "text",
        hint: "Comma-separated question keys, e.g. nev,munkaltato. Identifying questions (ID) are always locked.",
      },
      {
        key: "cancelSubject",
        deprecated: "Deprecated: edit this email on the Emails page (system email “Registration cancelled”). An email there overrides this field.",
        label: "Cancellation email subject",
        type: "text",
        hint: `Sent to a guest whose registration is cancelled (by them or an organizer). Placeholders {{name}}, {{event}}, {{registrationNumber}}, {{siteUrl}}. Default: ${GUEST_PORTAL_DEFAULTS.cancelSubject}`,
      },
      { key: "cancelMessage", deprecated: "Deprecated: edit this email on the Emails page (system email “Registration cancelled”). An email there overrides this field.", label: "Cancellation email text", type: "text", hint: "Empty = the built-in Hungarian text. Same placeholders as the subject." },
    ],
  });

  extensions.onBookingReleased(GUEST_PORTAL, async (booking, reason) => {
    if (reason === "cancelled" || reason === "attendee_cancelled") await sendCancellationEmails(booking);
  });
}
