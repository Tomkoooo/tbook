/**
 * Orchestration layer: booking, checkout, voucher, invoice (Számlázz.hu),
 * org/RBAC, tDarts sync, mail. Each service composes @tbook/domain (pure
 * calculations) with @tbook/db (repositories) and calls out to external
 * integrations (Stripe, Számlázz.hu, tDarts, SMTP).
 *
 * Ported module by module from the legacy plugin's
 * packages/plugins/t-book/services/*.ts. Done: org-service (org/RBAC),
 * booking-service (quote + single-event booking lifecycle, atomic capacity
 * reservation), voucher-service (issuance/check-in lifecycle, not PDF
 * generation), checkout-service (Stripe checkout session creation +
 * idempotent webhook finalization, single-event path only). Still to come:
 * invoice-service (Számlázz.hu) and tdarts-sync-service — checkout-service's
 * `AFTER_BOOKING_PAID_HOOKS` array is the extension point for both; voucher
 * PDF rendering + email delivery; multi-event booking
 * (quoteMulti/createPendingMultiBookings/createMultiBookingWithCheckout);
 * guest PDF download endpoints; admin listing/export methods.
 */
export * from "./org-secrets";
export * from "./api-key";
export * from "./org-auth";
export * from "./org-service";
export * from "./booking-validation";
export * from "./booking-service";
export * from "./voucher-service";
export * from "./checkout-service";
