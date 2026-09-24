import type { HotelPricing } from "@tbook/schemas";
import { describe, expect, it } from "vitest";
import { findPackageDeal, findRoomType, normalizeHotelPricing, packageUnitsForGuests, resolveAccommodationMode } from "./hotel-pricing";

describe("resolveAccommodationMode", () => {
  it("infers room_nights when only room types exist", () => {
    const pricing: HotelPricing = { priceBasis: "gross", vatPercent: 27, roomTypes: [{ key: "std", label: "Std", baseRateHuf: 1000, sortOrder: 0 }], packages: [], extrasSection: null, addonGroups: [] };
    expect(resolveAccommodationMode(pricing)).toBe("room_nights");
  });

  it("infers packages when only packages exist", () => {
    const pricing: HotelPricing = { priceBasis: "gross", vatPercent: 27, roomTypes: [], packages: [{ key: "wk", label: "Weekend", nights: 2, priceHuf: 10000, maxGuests: null, inventoryUnits: null, roomTypeKey: null, sortOrder: 0 }], extrasSection: null, addonGroups: [] };
    expect(resolveAccommodationMode(pricing)).toBe("packages");
  });

  it("respects an explicit accommodationMode over inference", () => {
    const pricing: HotelPricing = { priceBasis: "gross", vatPercent: 27, accommodationMode: "both", roomTypes: [], packages: [], extrasSection: null, addonGroups: [] };
    expect(resolveAccommodationMode(pricing)).toBe("both");
  });
});

describe("normalizeHotelPricing — legacy migration", () => {
  it("migrates a legacy baseRateHuf + room_type option into roomTypes", () => {
    const legacy: HotelPricing = {
      priceBasis: "net",
      vatPercent: 27,
      roomTypes: [],
      packages: [],
      extrasSection: null,
      addonGroups: [],
      baseRateHuf: 5000,
      baseRateMode: "per_person_per_night",
      options: [{ key: "room_type", label: "Room type", type: "select", required: true, defaultValue: null, sortOrder: 0, dependsOn: null, choices: [{ value: "deluxe", label: "Deluxe", priceHuf: 2000, priceMode: "fixed" }] }],
    };
    const normalized = normalizeHotelPricing(legacy);
    expect(normalized.roomTypes).toHaveLength(1);
    expect(normalized.roomTypes[0]!.baseRateHuf).toBe(7000); // legacy base + choice surcharge
  });

  it("falls back to a single 'standard' room when there is no legacy room_type option", () => {
    const legacy: HotelPricing = { priceBasis: "net", vatPercent: 27, roomTypes: [], packages: [], extrasSection: null, addonGroups: [], baseRateHuf: 3000 };
    const normalized = normalizeHotelPricing(legacy);
    expect(normalized.roomTypes).toEqual([{ key: "standard", label: "Standard room", baseRateHuf: 3000, sortOrder: 0 }]);
  });
});

describe("findRoomType / findPackageDeal", () => {
  const pricing: HotelPricing = {
    priceBasis: "gross",
    vatPercent: 27,
    roomTypes: [{ key: "std", label: "Std", baseRateHuf: 1000, sortOrder: 0 }],
    packages: [{ key: "wk", label: "Weekend", nights: 2, priceHuf: 10000, maxGuests: 2, inventoryUnits: null, roomTypeKey: null, sortOrder: 0 }],
    extrasSection: null,
    addonGroups: [],
  };

  it("finds a room type by key", () => {
    expect(findRoomType(pricing, "std")?.label).toBe("Std");
    expect(findRoomType(pricing, "missing")).toBeNull();
  });

  it("finds a package deal by key", () => {
    expect(findPackageDeal(pricing, "wk")?.label).toBe("Weekend");
  });
});

describe("packageUnitsForGuests", () => {
  it("defaults maxGuests to 1 when unset", () => {
    expect(packageUnitsForGuests({ maxGuests: null }, 4)).toBe(4);
  });

  it("ceils guest count over the package capacity", () => {
    expect(packageUnitsForGuests({ maxGuests: 2 }, 5)).toBe(3);
  });
});
