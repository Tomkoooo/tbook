/**
 * Orchestration layer: booking, checkout, voucher, invoice (Számlázz.hu),
 * org/RBAC, tDarts sync, mail. Each service composes @tbook/domain (pure
 * calculations) with @tbook/db (repositories) and calls out to external
 * integrations (Stripe, Számlázz.hu, tDarts, SMTP).
 *
 * Ported module by module from the legacy plugin's
 * packages/plugins/t-book/services/*.ts. Done: org-service (org/RBAC),
 * booking-service (quote + single-event booking lifecycle, atomic capacity
 * reservation), voucher-service (issuance/check-in lifecycle), checkout-
 * service (Stripe checkout session creation + idempotent webhook
 * finalization, single-event path only), invoice-service (Számlázz.hu,
 * org-scoped credentials only) and tdarts-sync-service (partner enroll,
 * solo/pair/skip-team-roster strategies) — both registered into checkout-
 * service's `AFTER_BOOKING_PAID_HOOKS` extension point.
 *
 * Voucher PDF rendering (voucher-pdf.ts — fully admin-customizable
 * block-based layout, packages/schemas' voucherPdfLayout), local media
 * storage (media-storage.ts), email delivery (mailer.ts), and their
 * orchestration (voucher-pdf-email.ts, also registered into
 * AFTER_BOOKING_PAID_HOOKS) are done — this closes out the last deferred
 * item from the previous pass. Invoice PDF storage rides on the same
 * media-storage.ts.
 *
 * Also done: public-catalog-service.ts (listPublicDirectory/
 * listPublicEventsForGroup/getPublicEventDetail — the public storefront
 * read models), currency.ts, rate-limit.ts, and
 * checkout-service.ts's loadBookingForGuestCheckout (the guest bearer-token
 * gate for invoice/voucher PDF downloads). These, plus the services above,
 * are wired into real HTTP routes at apps/web/src/app/api/v1/** — the
 * byte-compatible public API the still-running Sörfeszt/World Darts
 * Festival storefronts call.
 *
 * Auth: bootstrap-admin.ts (BOOTSTRAP_ADMIN_EMAILS/BOOTSTRAP_SYSTEM_ADMIN_EMAILS
 * allowlist promotion to isSystemAdmin) — the NextAuth instance itself,
 * Google OAuth config, and session callbacks live in apps/web (framework-
 * specific), but this package stays framework-agnostic.
 *
 * Still to come: multi-event booking (quoteMulti/
 * createPendingMultiBookings/createMultiBookingWithCheckout) and its v1
 * routes (currently 501); the public entry-list read model
 * (getPublicEntryList) and its route; the OpenAPI spec route; the org/system
 * ADMIN API ROUTES (separate pass — org-service/org-auth are fully built,
 * just no apps/web routes yet, now that real session auth exists to gate
 * them); admin listing/export methods; tDarts resyncEvent/backfill; header
 * images for voucher PDFs are only resolved from an absolute http(s) URL —
 * no general internal media-upload feature exists yet for an admin to host
 * one locally; auto-processing a pending org invite on sign-in (an invited
 * user can still use their invite token/link manually in the meantime).
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
export * from "./media-storage";
export * from "./mailer";
export * from "./voucher-pdf";
export * from "./voucher-pdf-email";
export * from "./currency";
export * from "./rate-limit";
export * from "./webhook-service";
export * from "./booking-admin-service";
export * from "./voucher-admin-service";
export * from "./public-catalog-service";
export * from "./bootstrap-admin";
