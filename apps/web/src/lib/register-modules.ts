/**
 * Side-effect import: registers every feature module (@tbook/modules) with
 * the core registry. Imported by each server entry point that can create,
 * confirm or cancel a booking (admin actions/pages, v1, v2, payment
 * webhooks), so module hooks run whichever path a booking takes.
 * Registration is idempotent.
 */
import "@tbook/modules";
