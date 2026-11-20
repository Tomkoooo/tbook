import { registerModule } from "@tbook/services";
import { STAND_MODE } from "./service";

export * from "./service";
export * from "./model";

export function registerStandModeModule(): void {
  registerModule({
    key: STAND_MODE,
    name: "Stand mode",
    description:
      "In-person drink and food stand without tickets: products, opening/closing inventory, restocking, cash/card sales, internal consumption, deposit (visszaváltási érték), profit and emailed Excel closing reports.",
    scopes: ["org", "group", "event"],
    configFields: [
      { key: "reportEmail", label: "Default closing report recipient", type: "text", hint: "The closing report with the Excel is sent here unless you change it when closing." },
      { key: "packs", label: "Quick restock amounts", type: "text", hint: "Comma separated. Default 6, 10, 12, 20." },
    ],
  });
}
