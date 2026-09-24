import { z } from "zod";
import { entityStatusSchema, objectIdSchema, priceBasisSchema, vatPercentSchema } from "./common";
import { attendeeFieldDefSchema, optionDefSchema } from "./value-objects";

/** Ported from the legacy plugin's models/TBookHotel.ts. */

export const roomTypeSchema = z.object({
  key: z.string(),
  label: z.string(),
  baseRateHuf: z.number().min(0),
  sortOrder: z.number().default(0),
});
export type RoomType = z.infer<typeof roomTypeSchema>;

export const packageDealSchema = z.object({
  key: z.string(),
  label: z.string(),
  nights: z.number().min(1),
  priceHuf: z.number().min(0),
  maxGuests: z.number().min(1).max(50).nullable().default(null),
  /** Total room/package units allotted (hotel inventory). Null = unlimited. */
  inventoryUnits: z.number().min(0).max(10_000).nullable().default(null),
  roomTypeKey: z.string().nullable().default(null),
  sortOrder: z.number().default(0),
});
export type PackageDeal = z.infer<typeof packageDealSchema>;

export const extrasSectionSchema = z.object({
  label: z.string(),
  description: z.string().default(""),
  options: z.array(optionDefSchema).default([]),
});

/** @deprecated Migrated to extrasSection on read — kept for legacy reads. */
export const addonGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().default(""),
  sortOrder: z.number().default(0),
  options: z.array(optionDefSchema).default([]),
});

export const accommodationModes = ["room_nights", "packages", "both"] as const;
export const accommodationModeSchema = z.enum(accommodationModes);

/** @deprecated Legacy flat pricing — migrated on read via normalizeHotelPricing. */
export const baseRateModes = ["per_person_per_night", "per_night", "per_person", "per_booking"] as const;
export const baseRateModeSchema = z.enum(baseRateModes);

export const hotelPricingSchema = z.object({
  priceBasis: priceBasisSchema.default("net"),
  vatPercent: vatPercentSchema.default(27),
  accommodationMode: accommodationModeSchema.optional(),
  roomTypes: z.array(roomTypeSchema).default([]),
  packages: z.array(packageDealSchema).default([]),
  extrasSection: extrasSectionSchema.nullable().default(null),
  addonGroups: z.array(addonGroupSchema).default([]),
  baseRateHuf: z.number().min(0).optional(),
  baseRateMode: baseRateModeSchema.optional(),
  options: z.array(optionDefSchema).optional(),
});
export type HotelPricing = z.infer<typeof hotelPricingSchema>;

export const hotelSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema.nullable().default(null),
  /** Hotels are owned by the event group (shared across events). */
  groupId: objectIdSchema.nullable().default(null),
  /** @deprecated Legacy per-event hotels — migrated to groupId on read. */
  eventId: objectIdSchema.nullable().default(null),
  name: z.string().min(1),
  description: z.string().default(""),
  address: z.string().default(""),
  distanceFromVenueKm: z.number().min(0).nullable().default(null),
  contactEmail: z.string().default(""),
  contactPhone: z.string().default(""),
  gallery: z.array(z.string()).default([]),
  currency: z.string().default("HUF"),
  bookingCapacity: z.number().min(0).nullable().default(null),
  roomInventory: z.number().min(0).nullable().default(null),
  registrationFieldSchema: z.array(attendeeFieldDefSchema).default([]),
  pricing: hotelPricingSchema,
  status: entityStatusSchema.default("draft"),
  sortOrder: z.number().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Hotel = z.infer<typeof hotelSchema>;

export const createHotelInputSchema = hotelSchema.pick({
  organizationId: true,
  groupId: true,
  name: true,
  pricing: true,
});
export type CreateHotelInput = z.infer<typeof createHotelInputSchema>;
