/**
 * Orchestration layer: booking, checkout, voucher, invoice (Számlázz.hu),
 * org/RBAC, tDarts sync, mail. Each service composes @tbook/domain (pure
 * calculations) with @tbook/db (repositories) and calls out to external
 * integrations (Stripe, Számlázz.hu, tDarts, SMTP).
 *
 * Ported module by module in Phase 2/3 from the legacy plugin's
 * packages/plugins/t-book/services/*.ts (booking-service, checkout-service,
 * event-service, invoice-service, org-service, tdarts-sync-service,
 * voucher-service).
 */
export const SERVICES_LAYER_VERSION = "0.0.0-bootstrap";
