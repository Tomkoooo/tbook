import { registerBusTransportModule } from "./bus-transport";
import { registerEventEmailsModule } from "./event-emails";
import { registerFreeRegistrationModule } from "./free-registration";
import { registerGuestPortalModule } from "./guest-portal";
import { registerWaitlistModule } from "./waitlist";
import { registerFeedbackModule } from "./feedback";

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
}

registerAllModules();

export * as busTransport from "./bus-transport";
export * as eventEmails from "./event-emails";
export * as guestPortal from "./guest-portal";
export * as waitlist from "./waitlist";
export * as feedback from "./feedback";
export { FREE_REGISTRATION } from "./free-registration";
export { BUS_TRANSPORT } from "./bus-transport";
export { EVENT_EMAILS } from "./event-emails";
export { GUEST_PORTAL } from "./guest-portal";
export { WAITLIST } from "./waitlist";
export { FEEDBACK } from "./feedback";
export { setModuleMailTransporter } from "./shared/mail";
export * as testData from "./test-data";
