import { registerBusTransportModule } from "./bus-transport";
import { registerEventEmailsModule } from "./event-emails";
import { registerFreeRegistrationModule } from "./free-registration";
import { registerGuestPortalModule } from "./guest-portal";
import { registerWaitlistModule } from "./waitlist";
import { registerFeedbackModule } from "./feedback";
import { registerStandModeModule } from "./stand-mode";
import { registerPointOfSaleModule } from "./point-of-sale";
import { registerHotelsModule } from "./hotels";
import { registerTicketSalesModule } from "./ticket-sales";

/**
 * Every feature module shipped with tBook. Importing this package registers
 * them with the core registry (idempotent — safe from several bundles).
 * Whether a module does anything for an organization/event is decided at
 * runtime by its switches (see @tbook/services module-registry).
 */
export function registerAllModules(): void {
  registerFreeRegistrationModule();
  registerBusTransportModule();
  registerEventEmailsModule();
  registerGuestPortalModule();
  registerWaitlistModule();
  registerFeedbackModule();
  registerStandModeModule();
  registerPointOfSaleModule();
  registerHotelsModule();
  registerTicketSalesModule();
}

registerAllModules();

export * as busTransport from "./bus-transport";
export * as eventEmails from "./event-emails";
export * as guestPortal from "./guest-portal";
export * as waitlist from "./waitlist";
export * as feedback from "./feedback";
export * as stand from "./stand-mode";
export { FREE_REGISTRATION } from "./free-registration";
export { BUS_TRANSPORT } from "./bus-transport";
export { EVENT_EMAILS } from "./event-emails";
export { GUEST_PORTAL } from "./guest-portal";
export { WAITLIST } from "./waitlist";
export { FEEDBACK } from "./feedback";
export { STAND_MODE } from "./stand-mode";
export { POINT_OF_SALE } from "./point-of-sale";
export { HOTELS } from "./hotels";
export { TICKET_SALES } from "./ticket-sales";
export { setModuleMailTransporter } from "./shared/mail";
export * as testData from "./test-data";
export { systemEmailDefault, type SystemEmailDefault } from "./system-email-defaults";
