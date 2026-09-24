import type { PackageDeal } from "@tbook/schemas";
import { describe, expect, it } from "vitest";
import { packageUnitsFromSelections, remainingHotelBookingCapacity, remainingHotelRoomInventory, totalPackageUnits, withPackageRemainingUnits } from "./package-inventory";

const packages: PackageDeal[] = [{ key: "weekend", label: "Weekend", nights: 2, priceHuf: 10000, maxGuests: 2, inventoryUnits: 5, roomTypeKey: null, sortOrder: 0 }];

describe("packageUnitsFromSelections", () => {
  it("derives units from a single package_deal selection using its maxGuests", () => {
    expect(packageUnitsFromSelections({ package_deal: "weekend" }, packages, 5)).toEqual({ weekend: 3 });
  });

  it("uses explicit package_units when provided", () => {
    expect(packageUnitsFromSelections({ package_units: { weekend: 2 } }, packages, 5)).toEqual({ weekend: 2 });
  });
});

describe("totalPackageUnits", () => {
  it("sums all requested units", () => {
    expect(totalPackageUnits({ a: 2, b: 3 })).toBe(5);
  });
});

describe("remainingHotelRoomInventory / remainingHotelBookingCapacity", () => {
  it("returns null when unlimited", () => {
    expect(remainingHotelRoomInventory(null, 10)).toBeNull();
    expect(remainingHotelBookingCapacity(undefined, 10)).toBeNull();
  });

  it("clamps at zero, never negative", () => {
    expect(remainingHotelRoomInventory(5, 8)).toBe(0);
    expect(remainingHotelBookingCapacity(5, 8)).toBe(0);
  });
});

describe("withPackageRemainingUnits", () => {
  it("caps package remaining units by a shared hotel-wide pool", () => {
    const [result] = withPackageRemainingUnits(packages, { weekend: 1 }, 2);
    // package has 5-1=4 remaining, but the shared pool only has 2 left
    expect(result!.remainingUnits).toBe(2);
  });
});
