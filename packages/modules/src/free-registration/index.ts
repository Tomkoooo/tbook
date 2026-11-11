import { extensions, registerModule } from "@tbook/services";

/**
 * Free registration: a zero-total booking for an event with this module on
 * skips Stripe and invoicing and is confirmed at once — vouchers, the
 * confirmation email(s) and every module hook run as for a paid booking.
 * The storefront is sent straight to its success page.
 */
export const FREE_REGISTRATION = "free-registration";

export function registerFreeRegistrationModule(): void {
  registerModule({
    key: FREE_REGISTRATION,
    name: "Free registration",
    description: "Zero-price registrations are confirmed immediately, without Stripe checkout or an invoice.",
    scopes: ["org", "group", "event"],
  });

  extensions.registerCheckoutBypass(FREE_REGISTRATION, async (booking, ctx) => booking.totalHuf <= 0 && ctx.modules.isOn(FREE_REGISTRATION));
}
