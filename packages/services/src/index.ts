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
 * idempotent webhook finalization, single-event path only), invoice-service
 * (Számlázz.hu, org-scoped credentials only, no PDF storage yet) and
 * tdarts-sync-service (partner enroll, solo/pair/skip-team-roster
 * strategies) — both registered into checkout-service's
 * `AFTER_BOOKING_PAID_HOOKS` extension point. Still to come: voucher PDF
 * rendering + email delivery (invoice PDF storage rides along with it);
 * multi-event booking (quoteMulti/createPendingMultiBookings/
 * createMultiBookingWithCheckout); guest PDF download endpoints; admin
 * listing/export methods; tDarts resyncEvent/backfill.
 */
export * from "./org-secrets";
export * from "./api-key";
export * from "./org-auth";
export * from "./org-service";
export * from "./booking-validation";
export * from "./booking-service";
export * from "./voucher-service";
export * from "./checkout-service";
export * from "./invoice-service";
export * from "./tdarts-sync-service";
