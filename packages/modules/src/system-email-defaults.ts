import type { ResolvedModules } from "@tbook/services";
import { BUS_WAITLIST_DEFAULTS, type BusWaitlistConfig } from "./bus-transport/waitlist";
import type { SystemEmailTrigger } from "./event-emails/model";
import { plainTextToTemplateHtml } from "./event-emails/system";
import { GUEST_PORTAL_DEFAULTS, type GuestPortalConfig } from "./guest-portal/service";
import { WAITLIST_DEFAULTS, type WaitlistConfig } from "./waitlist/service";

export interface SystemEmailDefault {
  subject: string;
  /** Editor HTML of the text. */
  body: string;
  /** Where the text comes from today: the module's (deprecated) settings fields, or the built-in text. */
  source: "module_settings" | "built_in";
}

/**
 * What a system email sends for an event that has no template of the
 * trigger: the module settings text when set (deprecated, kept for
 * existing configs), else the built-in Hungarian text. The Emails page
 * shows it and starts a new template from it.
 */
export function systemEmailDefault(trigger: SystemEmailTrigger, modules: ResolvedModules): SystemEmailDefault {
  const pick = (configSubject: string | undefined, configText: string | undefined, subject: string, text: string): SystemEmailDefault => {
    const customSubject = configSubject?.trim();
    const customText = configText?.trim();
    return {
      subject: customSubject || subject,
      body: plainTextToTemplateHtml(customText || text),
      source: customSubject || customText ? "module_settings" : "built_in",
    };
  };
  switch (trigger) {
    case "waitlist_joined":
    case "waitlist_offer":
    case "waitlist_registered": {
      const kind = trigger === "waitlist_joined" ? "joined" : trigger === "waitlist_offer" ? "offer" : "registered";
      const config = modules.config<WaitlistConfig>("waitlist");
      return pick(config[`${kind}Subject`], config[`${kind}Message`], WAITLIST_DEFAULTS[`${kind}Subject`], WAITLIST_DEFAULTS[`${kind}Message`]);
    }
    case "bus_seat_freed": {
      const config = modules.config<BusWaitlistConfig>("bus-transport");
      return pick(config.busWaitlistSubject, config.busWaitlistMessage, BUS_WAITLIST_DEFAULTS.subject, BUS_WAITLIST_DEFAULTS.message);
    }
    case "booking_cancelled": {
      const config = modules.config<GuestPortalConfig>("guest-portal");
      return pick(config.cancelSubject, config.cancelMessage, GUEST_PORTAL_DEFAULTS.cancelSubject, GUEST_PORTAL_DEFAULTS.cancelMessage);
    }
  }
}
