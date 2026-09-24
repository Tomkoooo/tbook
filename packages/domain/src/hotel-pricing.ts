import type { HotelPricing, OptionDef, PackageDeal, RoomType } from "@tbook/schemas";

/** @tbook/schemas doesn't export this as a standalone type — derive it from HotelPricing. */
type AccommodationMode = NonNullable<HotelPricing["accommodationMode"]>;

/**
 * Ported from the legacy plugin's lib/hotel-pricing.ts.
 *
 * Deliberately dropped vs. the legacy version (moved out of pure domain,
 * revisit when the admin hotel-editor is built in Phase 5): the Hungarian
 * ACCOMMODATION_MODE_LABELS UI copy, and the save-time key-assignment
 * helpers (assignPricingKeys/slugifyHotelKey/uniqueKey/resolveKey/
 * resolveChoiceValue/assignOptionKeys, formatPackageDealCapacityLabel) —
 * those are admin-form-save concerns, not pricing-engine concerns.
 */

type ExtrasSection = NonNullable<HotelPricing["extrasSection"]>;

/** Selection key for the chosen room type (matches RoomType.key). */
export const ROOM_TYPE_SELECTION_KEY = "room_type";
/** Selection key for an optional fixed package deal instead of per-night pricing. */
export const PACKAGE_DEAL_SELECTION_KEY = "package_deal";
/** Multi-package plan: package key → unit count (mixed room types). */
export const PACKAGE_UNITS_SELECTION_KEY = "package_units";

/** Effective mode — explicit field or inferred from stored pricing shape. */
export function resolveAccommodationMode(pricing: HotelPricing): AccommodationMode {
  if (pricing.accommodationMode) return pricing.accommodationMode;
  const packages = pricing.packages ?? [];
  const rooms = pricing.roomTypes ?? [];
  if (packages.length > 0 && rooms.length === 0) return "packages";
  if (packages.length > 0) return "both";
  return "room_nights";
}

export function hotelShowsRoomSelection(pricing: HotelPricing): boolean {
  const mode = resolveAccommodationMode(pricing);
  return mode === "room_nights" || mode === "both";
}

export function hotelShowsPackageSelection(pricing: HotelPricing): boolean {
  const mode = resolveAccommodationMode(pricing);
  return mode === "packages" || mode === "both";
}

export function hotelRequiresPackageSelection(pricing: HotelPricing): boolean {
  return resolveAccommodationMode(pricing) === "packages";
}

/** Admin save guard mirroring the Zod schema's implicit rules. */
export function validateHotelPricingConfig(pricing: HotelPricing): string | null {
  const mode = resolveAccommodationMode(pricing);
  const hasLegacy = pricing.baseRateHuf != null || (pricing.options?.length ?? 0) > 0;
  if ((mode === "room_nights" || mode === "both") && pricing.roomTypes.length === 0 && !hasLegacy) {
    return "At least one room type is required.";
  }
  if (mode === "packages" && (pricing.packages ?? []).length === 0) {
    return "At least one package deal is required.";
  }
  return null;
}

function migrateAddonGroupsToExtras(addonGroups: NonNullable<HotelPricing["addonGroups"]>): ExtrasSection | null {
  if (addonGroups.length === 0) return null;
  const first = addonGroups[0]!;
  const options = addonGroups.flatMap((group) => group.options);
  if (!first.label.trim() && options.length === 0) return null;
  return { label: first.label || "Extras & surcharges", description: first.description ?? "", options };
}

/** Normalizes legacy flat `baseRate + options[]` into room types + a grouped extras section. */
export function normalizeHotelPricing(raw: HotelPricing): HotelPricing {
  const base = {
    priceBasis: raw.priceBasis ?? "net",
    vatPercent: raw.vatPercent ?? 27,
    packages: raw.packages ?? [],
    accommodationMode: raw.accommodationMode,
  };

  if (raw.roomTypes?.length) {
    const extrasSection = raw.extrasSection ?? migrateAddonGroupsToExtras(raw.addonGroups ?? []) ?? null;
    return { ...base, roomTypes: raw.roomTypes, extrasSection, addonGroups: [] };
  }

  if ((raw.packages?.length ?? 0) > 0 && resolveAccommodationMode(raw) === "packages") {
    const extrasSection = raw.extrasSection ?? migrateAddonGroupsToExtras(raw.addonGroups ?? []) ?? null;
    return { ...base, roomTypes: [], extrasSection, addonGroups: [] };
  }

  const legacyBase = raw.baseRateHuf ?? 0;
  const legacyOptions = raw.options ?? [];
  const roomTypeOption = legacyOptions.find((o) => o.key === ROOM_TYPE_SELECTION_KEY);
  const otherOptions = legacyOptions.filter((o) => o.key !== ROOM_TYPE_SELECTION_KEY);

  let roomTypes: RoomType[];
  if (roomTypeOption?.choices?.length) {
    roomTypes = roomTypeOption.choices.map((choice, index) => ({
      key: choice.value || `room_${index}`,
      label: choice.label,
      baseRateHuf: legacyBase + (choice.priceHuf ?? 0),
      sortOrder: index,
    }));
  } else {
    roomTypes = [{ key: "standard", label: "Standard room", baseRateHuf: legacyBase, sortOrder: 0 }];
  }

  const extrasSection: ExtrasSection | null =
    otherOptions.length > 0
      ? { label: "Surcharges & extras", description: "", options: otherOptions }
      : (raw.extrasSection ?? migrateAddonGroupsToExtras(raw.addonGroups ?? []) ?? null);

  return { ...base, roomTypes, extrasSection, addonGroups: [] };
}

export function flattenAddonOptions(pricing: HotelPricing): OptionDef[] {
  const normalized = normalizeHotelPricing(pricing);
  return [...(normalized.extrasSection?.options ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function getExtrasSection(pricing: HotelPricing): ExtrasSection | null {
  const normalized = normalizeHotelPricing(pricing);
  const section = normalized.extrasSection;
  if (!section) return null;
  if (!section.label.trim() && section.options.length === 0) return null;
  return section;
}

export function findRoomType(pricing: HotelPricing, roomTypeKey: string): RoomType | null {
  const normalized = normalizeHotelPricing(pricing);
  return normalized.roomTypes.find((r) => r.key === roomTypeKey) ?? null;
}

export function findPackageDeal(pricing: HotelPricing, packageKey: string): PackageDeal | null {
  const normalized = normalizeHotelPricing(pricing);
  return normalized.packages?.find((p) => p.key === packageKey) ?? null;
}

/** Packages matching the selected room type and night count (room_nights / both modes). */
export function matchingPackageDeals(pricing: HotelPricing, nights: number, roomTypeKey: string): PackageDeal[] {
  const normalized = normalizeHotelPricing(pricing);
  return (normalized.packages ?? []).filter((pkg) => pkg.nights === nights && (!pkg.roomTypeKey || pkg.roomTypeKey === roomTypeKey));
}

/** Packages shown to guests — mode-aware. */
export function guestPackageDeals(pricing: HotelPricing, nights?: number, roomTypeKey?: string): PackageDeal[] {
  const normalized = normalizeHotelPricing(pricing);
  const mode = resolveAccommodationMode(normalized);
  let deals = [...(normalized.packages ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (mode === "packages") {
    if (nights != null && nights > 0) {
      deals = deals.filter((pkg) => pkg.nights === nights);
    }
    return deals;
  }

  if (!roomTypeKey) return [];
  return matchingPackageDeals(normalized, nights ?? 1, roomTypeKey);
}

/**
 * Package units required for a guest count. Unset/null maxGuests defaults to
 * 1 (one guest per package unit) so room packages scale with headcount.
 */
export function packageUnitsForGuests(packageDeal: Pick<PackageDeal, "maxGuests">, guests: number): number {
  const cap = packageDeal.maxGuests != null && packageDeal.maxGuests > 0 ? packageDeal.maxGuests : 1;
  return Math.max(1, Math.ceil(Math.max(1, guests) / cap));
}

export function packageDealCapacity(packageDeal: Pick<PackageDeal, "maxGuests">): number {
  return packageDeal.maxGuests != null && packageDeal.maxGuests > 0 ? packageDeal.maxGuests : 1;
}

export function parsePackageUnits(selections: Record<string, unknown>): Record<string, number> | null {
  const raw = selections[PACKAGE_UNITS_SELECTION_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const units: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const qty = Number(value);
    if (Number.isFinite(qty) && qty > 0) units[key] = Math.floor(qty);
  }
  return Object.keys(units).length > 0 ? units : null;
}

/** Rough count of distinct customer configuration paths (for admin UX). */
function choicePaths(option: OptionDef): number {
  switch (option.type) {
    case "select":
      return Math.max(1, option.choices?.length ?? 1);
    case "multiselect": {
      const n = option.choices?.length ?? 0;
      return n === 0 ? 1 : n + 1;
    }
    case "number": {
      const min = option.min ?? 0;
      const max = option.max ?? min;
      return Math.max(1, max - min + 1);
    }
    case "checkbox":
      return 2;
    default:
      return 1;
  }
}

export interface HotelComplexityStats {
  roomTypeCount: number;
  packageCount: number;
  addonOptionCount: number;
  /** room types × product(add-on branch counts) */
  estimatedBookingPaths: number;
}

export function hotelComplexityStats(pricing: HotelPricing): HotelComplexityStats {
  const normalized = normalizeHotelPricing(pricing);
  const mode = resolveAccommodationMode(normalized);
  const addons = flattenAddonOptions(normalized);
  const addonPaths = addons.reduce((acc, option) => acc * choicePaths(option), 1);
  const packageCount = normalized.packages?.length ?? 0;
  const roomTypeCount = normalized.roomTypes.length;
  const primaryPaths = mode === "packages" ? Math.max(1, packageCount) : mode === "both" ? Math.max(1, roomTypeCount) + packageCount : Math.max(1, roomTypeCount);
  return {
    roomTypeCount,
    packageCount,
    addonOptionCount: addons.length,
    estimatedBookingPaths: primaryPaths * addonPaths,
  };
}

export function eventHotelsComplexitySummary(hotels: Array<{ pricing: HotelPricing }>): {
  hotelCount: number;
  totalRoomTypes: number;
  totalPackages: number;
  totalEstimatedPaths: number;
} {
  let totalRoomTypes = 0;
  let totalPackages = 0;
  let totalEstimatedPaths = 0;
  for (const hotel of hotels) {
    const stats = hotelComplexityStats(hotel.pricing);
    totalRoomTypes += stats.roomTypeCount;
    totalPackages += stats.packageCount;
    totalEstimatedPaths += stats.estimatedBookingPaths;
  }
  return { hotelCount: hotels.length, totalRoomTypes, totalPackages, totalEstimatedPaths };
}
