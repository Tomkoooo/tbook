import { registerModule } from "@tbook/services";

/**
 * Hotels: accommodation guests can add to their booking. A navigation /
 * entitlement module: it decides whether the console offers hotels (for an
 * organization, an event group or a single event). Pricing and booking rules
 * live in @tbook/domain and @tbook/services and are unchanged.
 */
export const HOTELS = "hotels";

export function registerHotelsModule(): void {
  registerModule({
    key: HOTELS,
    name: "Hotels",
    description: "Accommodation guests can add to their booking: hotels, rooms and packages per event group or event.",
    scopes: ["org", "group", "event"],
    defaultOn: true,
  });
}
