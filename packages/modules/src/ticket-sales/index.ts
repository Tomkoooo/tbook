import { registerModule } from "@tbook/services";

/**
 * Ticket selling: bookings list, booking details and door check-in. A
 * navigation / entitlement module: it decides whether the console offers
 * these pages. The public v1 booking API is unaffected.
 */
export const TICKET_SALES = "ticket-sales";

export function registerTicketSalesModule(): void {
  registerModule({
    key: TICKET_SALES,
    name: "Ticket selling",
    description: "Ticket bookings and door check-in: the bookings list, booking details, vouchers and scanning.",
    scopes: ["org", "event"],
    defaultOn: true,
  });
}
