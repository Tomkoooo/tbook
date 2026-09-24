import type { PackageDeal } from "@tbook/schemas";
import { PACKAGE_DEAL_SELECTION_KEY, packageUnitsForGuests, parsePackageUnits } from "./hotel-pricing";

/**
 * Ported from the legacy plugin's lib/package-inventory.ts — pure
 * computation only. The legacy file mixed these with Mongoose-querying
 * async functions (countSoldPackageUnitsForHotel, assertHotelRoomInventory
 * Available, assertPackageInventoryAvailable, countSoldAccommodationGuests
 * ForHotel, assertHotelBookingCapacityAvailable) that need repository
 * access — those belong in @tbook/services (Phase 3), built on top of
 * these pure helpers plus a booking repository "sold units" query.
 */

/** Units requested for each package key from a booking's selections. */
export function packageUnitsFromSelections(selections: Record<string, unknown>, packages: PackageDeal[], accommodationGuests: number): Record<string, number> {
  const units = parsePackageUnits(selections);
  if (units) return units;

  const dealKey = String(selections[PACKAGE_DEAL_SELECTION_KEY] ?? "").trim();
  if (!dealKey) return {};

  const deal = packages.find((pkg) => pkg.key === dealKey);
  if (!deal) return { [dealKey]: 1 };

  return { [dealKey]: packageUnitsForGuests(deal, accommodationGuests) };
}

export function totalPackageUnits(units: Record<string, number>): number {
  return Object.values(units).reduce((sum, qty) => sum + Math.max(0, qty), 0);
}

export function remainingHotelRoomInventory(roomInventory: number | null | undefined, soldUnits: number): number | null {
  if (roomInventory == null || roomInventory < 0) return null;
  return Math.max(0, roomInventory - soldUnits);
}

export function remainingHotelBookingCapacity(bookingCapacity: number | null | undefined, soldGuests: number): number | null {
  if (bookingCapacity == null || bookingCapacity < 0) return null;
  return Math.max(0, bookingCapacity - soldGuests);
}

/**
 * Attach remainingUnits onto packages for public hotel payloads. When
 * `sharedRemaining` is set, each package is additionally capped by the
 * shared hotel room pool.
 */
export function withPackageRemainingUnits(packages: PackageDeal[], soldByKey: Record<string, number>, sharedRemaining?: number | null): Array<PackageDeal & { remainingUnits: number | null }> {
  return packages.map((pkg) => {
    const packageRemaining = pkg.inventoryUnits == null || pkg.inventoryUnits < 0 ? null : Math.max(0, pkg.inventoryUnits - (soldByKey[pkg.key] ?? 0));

    if (sharedRemaining == null) {
      return { ...pkg, remainingUnits: packageRemaining };
    }
    if (packageRemaining == null) {
      return { ...pkg, remainingUnits: sharedRemaining };
    }
    return { ...pkg, remainingUnits: Math.min(packageRemaining, sharedRemaining) };
  });
}

/** Drop sold-out package deals (keep unlimited packages). */
export function filterAvailablePackages<T extends { remainingUnits?: number | null }>(packages: T[]): T[] {
  return packages.filter((pkg) => pkg.remainingUnits == null || pkg.remainingUnits > 0);
}

export function isHotelPubliclyAvailable(opts: {
  remainingCapacity: number | null;
  remainingRoomInventory?: number | null;
  accommodationMode: "room_nights" | "packages" | "both";
  availablePackages: unknown[];
  /** True when the hotel had at least one package with inventory tracking. */
  hadLimitedPackages: boolean;
  /** True when the hotel has a shared room inventory pool. */
  hadRoomInventory?: boolean;
}): boolean {
  if (opts.remainingCapacity != null && opts.remainingCapacity <= 0) return false;
  if (opts.remainingRoomInventory != null && opts.remainingRoomInventory <= 0) return false;
  if (opts.accommodationMode === "packages" && (opts.hadLimitedPackages || opts.hadRoomInventory) && opts.availablePackages.length === 0) {
    return false;
  }
  return true;
}
