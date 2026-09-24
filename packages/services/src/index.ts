/**
 * Orchestration layer: booking, checkout, voucher, invoice (Számlázz.hu),
 * org/RBAC, tDarts sync, mail. Each service composes @tbook/domain (pure
 * calculations) with @tbook/db (repositories) and calls out to external
 * integrations (Stripe, Számlázz.hu, tDarts, SMTP).
 *
 * Ported module by module from the legacy plugin's
 * packages/plugins/t-book/services/*.ts. Done: org-service (org/RBAC),
 * booking-service (quote + booking lifecycle), voucher-service (lifecycle,
 * not PDF generation). Still to come: checkout-service (Stripe),
 * invoice-service (Számlázz.hu), tdarts-sync-service, voucher PDF issuance.
 */
export * from "./org-secrets";
export * from "./api-key";
export * from "./org-auth";
export * from "./org-service";
// TODO(this pass): re-enable once booking-service.ts / voucher-service.ts are written below.
// export * from "./booking-service";
// export * from "./voucher-service";
