import type { HotelPricing, OptionDef } from "@tbook/schemas";
import { describe, expect, it } from "vitest";
import { calculateBookingQuote, isOptionApplicable, validateHotelSelections, validateSelections } from "./pricing";

describe("calculateBookingQuote — ticket-only booking", () => {
  it("total equals ticket fee × guests for per_person mode", () => {
    const quote = calculateBookingQuote({ ticketFeeHuf: 5000, ticketFeeMode: "per_person", guests: 3 });
    expect(quote.ticketSubtotalHuf).toBe(15000);
    expect(quote.totalHuf).toBe(15000);
    expect(quote.accommodationSubtotalHuf).toBe(0);
  });

  it("per_booking ticket fee ignores guest count", () => {
    const quote = calculateBookingQuote({ ticketFeeHuf: 5000, ticketFeeMode: "per_booking", guests: 4 });
    expect(quote.ticketSubtotalHuf).toBe(5000);
  });

  it("guests are clamped to at least 1", () => {
    const quote = calculateBookingQuote({ ticketFeeHuf: 1000, guests: 0 });
    expect(quote.guests).toBe(1);
    expect(quote.ticketSubtotalHuf).toBe(1000);
  });

  it("converts net ticket price to gross using VAT", () => {
    const quote = calculateBookingQuote({ ticketFeeHuf: 1000, ticketPriceBasis: "net", ticketVatPercent: 27, guests: 1 });
    expect(quote.ticketSubtotalHuf).toBe(1270);
  });
});

const roomHotel: HotelPricing = {
  priceBasis: "gross",
  vatPercent: 27,
  accommodationMode: "room_nights",
  roomTypes: [{ key: "standard", label: "Standard", baseRateHuf: 10_000, sortOrder: 0 }],
  packages: [],
  extrasSection: null,
  addonGroups: [],
};

describe("calculateBookingQuote — with accommodation", () => {
  it("total = ticket + accommodation base for a room-night hotel", () => {
    const quote = calculateBookingQuote({
      ticketFeeHuf: 5000,
      guests: 2,
      accommodation: roomHotel,
      nights: 2,
      selections: { room_type: "standard" },
    });
    expect(quote.accommodationBaseHuf).toBe(40_000); // 10000 * 2 guests * 2 nights
    expect(quote.totalHuf).toBe(10_000 + 40_000);
  });

  it("nights are forced to at least 1 when accommodation is selected", () => {
    const quote = calculateBookingQuote({ ticketFeeHuf: 1000, guests: 1, accommodation: roomHotel, selections: { room_type: "standard" } });
    expect(quote.nights).toBe(1);
  });

  it("percent-mode add-on scales from the accommodation base", () => {
    const hotelWithAddon: HotelPricing = {
      ...roomHotel,
      extrasSection: {
        label: "Extras",
        description: "",
        options: [{ key: "service_fee", label: "Service fee", type: "select", required: false, defaultValue: null, dependsOn: null, sortOrder: 0, choices: [{ value: "yes", label: "Yes", priceHuf: 10, priceMode: "percent" }] }],
      },
    };
    const quote = calculateBookingQuote({
      ticketFeeHuf: 0,
      guests: 1,
      nights: 1,
      accommodation: hotelWithAddon,
      selections: { room_type: "standard", service_fee: "yes" },
    });
    // base = 10000 (1 guest x 1 night x 10000); 10% of that = 1000
    expect(quote.accommodationOptionsHuf).toBe(1000);
  });

  it("skips a dependent option when its dependency does not match", () => {
    const hotelWithDependent: HotelPricing = {
      ...roomHotel,
      extrasSection: {
        label: "Extras",
        description: "",
        options: [{ key: "late_checkout", label: "Late checkout", type: "checkbox", required: false, defaultValue: null, unitPriceHuf: 500, priceMode: "fixed", sortOrder: 0, dependsOn: { key: "room_type", values: ["deluxe"] } }],
      },
    };
    const quote = calculateBookingQuote({ ticketFeeHuf: 0, guests: 1, nights: 1, accommodation: hotelWithDependent, selections: { room_type: "standard", late_checkout: true } });
    expect(quote.accommodationOptionsHuf).toBe(0);
  });
});

describe("isOptionApplicable", () => {
  const base: OptionDef = { key: "opt", label: "Opt", type: "checkbox", required: false, defaultValue: null, sortOrder: 0, dependsOn: null };

  it("is true without a dependency", () => {
    expect(isOptionApplicable(base, {})).toBe(true);
  });

  it("matches dependency values", () => {
    const opt: OptionDef = { ...base, dependsOn: { key: "room_type", values: ["deluxe", "suite"] } };
    expect(isOptionApplicable(opt, { room_type: "deluxe" })).toBe(true);
    expect(isOptionApplicable(opt, { room_type: "standard" })).toBe(false);
    expect(isOptionApplicable(opt, {})).toBe(false);
  });
});

describe("validateSelections", () => {
  const options: OptionDef[] = [
    { key: "meals", label: "Meals", type: "select", required: true, defaultValue: null, sortOrder: 0, dependsOn: null, choices: [{ value: "bb", label: "Bed & breakfast", priceHuf: 0, priceMode: "fixed" }] },
    { key: "extra_bed", label: "Extra bed", type: "number", required: false, defaultValue: null, sortOrder: 1, dependsOn: null, min: 0, max: 2, unitPriceHuf: 1000, priceMode: "fixed" },
  ];

  it("accepts a valid selection set", () => {
    expect(validateSelections(options, { meals: "bb", extra_bed: 1 })).toEqual([]);
  });

  it("rejects unknown option keys", () => {
    const errors = validateSelections(options, { meals: "bb", unknown_key: "x" });
    expect(errors).toContainEqual({ key: "unknown_key", message: "Unknown option: unknown_key" });
  });

  it("rejects a missing required option", () => {
    const errors = validateSelections(options, {});
    expect(errors.some((e) => e.key === "meals")).toBe(true);
  });

  it("rejects numbers outside min/max", () => {
    const errors = validateSelections(options, { meals: "bb", extra_bed: 5 });
    expect(errors.some((e) => e.key === "extra_bed" && e.message.includes("maximum"))).toBe(true);
  });
});

describe("validateHotelSelections — package-only accommodation", () => {
  const packageHotel: HotelPricing = {
    priceBasis: "gross",
    vatPercent: 27,
    accommodationMode: "packages",
    roomTypes: [],
    packages: [{ key: "weekend", label: "Weekend package", nights: 2, priceHuf: 20_000, maxGuests: 2, inventoryUnits: null, roomTypeKey: null, sortOrder: 0 }],
    extrasSection: null,
    addonGroups: [],
  };

  it("requires a package selection when no room types exist", () => {
    const errors = validateHotelSelections(packageHotel, {}, 2);
    expect(errors.some((e) => e.key === "package_deal")).toBe(true);
  });

  it("accepts a valid package selection and does not flag it as unknown", () => {
    const errors = validateHotelSelections(packageHotel, { package_deal: "weekend" }, 2);
    expect(errors).toEqual([]);
  });
});
