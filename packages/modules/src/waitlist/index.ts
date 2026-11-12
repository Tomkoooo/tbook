import { extensions, registerModule } from "@tbook/services";
import { processWaitlist, WAITLIST, WAITLIST_DEFAULTS, waitlistHeldIdentifier } from "./service";

export * from "./service";
export * from "./model";

export function registerWaitlistModule(): void {
  registerModule({
    key: WAITLIST,
    name: "Waitlist",
    description:
      "When the event is full, guests join a waitlist (public API). A freed place goes to the first in line: registered automatically, or offered by email and held for a set time.",
    scopes: ["org", "group", "event"],
    configFields: [
      {
        key: "mode",
        label: "When a place frees up",
        type: "select",
        options: [
          { value: "offer", label: "Email the first in line; hold the place for them" },
          { value: "auto", label: "Register the first in line automatically (free events)" },
        ],
      },
      { key: "offerHours", label: "Hold an offered place for (hours)", type: "text", hint: "Default 48." },
      { key: "offerSubject", label: "Offer email subject", type: "text", hint: "Placeholders: {{name}}, {{event}}, {{hours}}" },
      { key: "offerMessage", label: "Offer email text", type: "text", hint: "Must contain {{link}}. Also {{name}}, {{event}}, {{hours}}." },
      { key: "registeredSubject", label: "Auto-registered email subject", type: "text" },
      { key: "registeredMessage", label: "Auto-registered email text", type: "text", hint: "The usual confirmation with the QR code is sent as well." },
      { key: "joinedSubject", label: "Joined-the-waitlist email subject", type: "text", hint: `Placeholders {{name}}, {{event}}, {{position}}, {{siteUrl}}. Default: ${WAITLIST_DEFAULTS.joinedSubject}` },
      {
        key: "joinedMessage",
        label: "Joined-the-waitlist email text",
        type: "text",
        hint: "Sent when someone joins. Placeholders {{name}}, {{event}}, {{position}} (1 = next in line), {{siteUrl}}. Empty = the built-in Hungarian text.",
      },
    ],
  });

  // An ID waiting on the list can't also register (or join twice).
  extensions.registerIdentifierHolder(WAITLIST, waitlistHeldIdentifier);

  // A freed place moves the line, whether or not someone is waiting (cheap when nobody is).
  extensions.onBookingReleased(WAITLIST, async (booking, reason) => {
    if (reason === "edited") return;
    await processWaitlist(String(booking.eventId));
  });
}
