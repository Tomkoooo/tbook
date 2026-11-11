import { registerModule } from "@tbook/services";
import { GUEST_PORTAL } from "./service";

export * from "./service";

export function registerGuestPortalModule(): void {
  registerModule({
    key: GUEST_PORTAL,
    name: "Guest self-service",
    description:
      "Guests look up, change or cancel their own registration on the event website with their registration number or ID (public API: /api/v1/guest/*).",
    scopes: ["org", "group", "event"],
    configFields: [
      { key: "allowEdit", label: "Guests may change their answers", type: "select", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
      {
        key: "allowCancel",
        label: "Guests may cancel (free registrations only)",
        type: "select",
        options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
      },
      {
        key: "lockedFields",
        label: "Questions guests can't change",
        type: "text",
        hint: "Comma-separated question keys, e.g. nev,munkaltato. Identifying questions (ID) are always locked.",
      },
    ],
  });
}
