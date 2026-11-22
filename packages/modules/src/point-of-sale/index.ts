import { registerModule } from "@tbook/services";

/**
 * Point of sale: the counter register (tickets and merchandise sold in
 * person, receipts, printer). A navigation / entitlement module: it only
 * decides whether the console offers the feature. The sale rules live in
 * @tbook/services and are unchanged.
 */
export const POINT_OF_SALE = "point-of-sale";

export function registerPointOfSaleModule(): void {
  registerModule({
    key: POINT_OF_SALE,
    name: "Point of sale",
    description: "Counter register: sell tickets and merchandise in person, with receipts and a thermal printer.",
    scopes: ["org", "event"],
    defaultOn: true,
  });
}
