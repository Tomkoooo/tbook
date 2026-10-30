import { z } from "zod";
import { entityStatusSchema, objectIdSchema, priceBasisSchema, vatPercentSchema } from "./common";
import { dayPassConfigSchema, eventKindSchema, publicListingSchema, registrationUnitSchema, ticketFeeModeSchema } from "./event";
import { packageDealSchema, roomTypeSchema } from "./hotel";

/**
 * Input shapes for the catalog console (event groups, events, hotels).
 * Updates are partial: the console edits the fields it exposes and leaves
 * everything else — attendee field schemas, eligibility rules, pricing
 * rules — exactly as the legacy data has it.
 */

const nullableCount = z.number().int().min(0).nullable();
const nullableDate = z.coerce.date().nullable();

export const adminEventGroupInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().max(5000).default(""),
  status: entityStatusSchema.default("draft"),
  defaultPriceBasis: priceBasisSchema.default("net"),
  defaultVatPercent: vatPercentSchema.default(27),
  listOnTBookSite: z.boolean().default(false),
  listingTitle: z.string().max(200).default(""),
  listingUrl: z.string().max(500).default(""),
});
export type AdminEventGroupInput = z.infer<typeof adminEventGroupInputSchema>;

export const adminEventInputSchema = z
  .object({
    groupId: objectIdSchema,
    name: z.string().trim().min(1, "Name is required").max(200),
    description: z.string().max(10_000).default(""),
    address: z.string().max(500).default(""),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    startTime: z.string().max(10).nullable().default(null),
    endTime: z.string().max(10).nullable().default(null),
    salesOpensAt: nullableDate.default(null),
    salesClosesAt: nullableDate.default(null),
    currency: z.string().length(3).default("HUF"),
    kind: eventKindSchema.default("standard"),
    /** Required when kind is "day_pass"; ignored (and cleared) otherwise. */
    dayPass: dayPassConfigSchema.nullable().default(null),
    ticketFeeHuf: z.number().min(0),
    ticketFeeMode: ticketFeeModeSchema.default("per_person"),
    registrationUnit: registrationUnitSchema.default("person"),
    playersPerTicket: z.number().int().min(1).max(100).default(1),
    ticketPriceBasis: priceBasisSchema.default("net"),
    ticketVatPercent: vatPercentSchema.default(27),
    capacity: nullableCount.default(null),
    vouchersEnabled: z.boolean().default(true),
    publicListing: publicListingSchema.default("listed"),
    status: entityStatusSchema.default("draft"),
    tdartsEnabled: z.boolean().default(false),
    tdartsTournamentCode: z.string().trim().max(100).nullable().default(null),
  })
  .refine((event) => event.endDate >= event.startDate, {
    message: "The end date can't be before the start date.",
    path: ["endDate"],
  })
  .refine((event) => event.kind !== "day_pass" || event.dayPass !== null, {
    message: "A day-pass event needs its weekday and weekend prices.",
    path: ["dayPass"],
  })
  .refine((event) => !event.salesOpensAt || !event.salesClosesAt || event.salesClosesAt >= event.salesOpensAt, {
    message: "Sales can't close before they open.",
    path: ["salesClosesAt"],
  });
export type AdminEventInput = z.infer<typeof adminEventInputSchema>;

export const adminHotelInputSchema = z.object({
  groupId: objectIdSchema,
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().max(10_000).default(""),
  address: z.string().max(500).default(""),
  distanceFromVenueKm: z.number().min(0).nullable().default(null),
  contactEmail: z.string().max(200).default(""),
  contactPhone: z.string().max(100).default(""),
  currency: z.string().length(3).default("HUF"),
  bookingCapacity: nullableCount.default(null),
  roomInventory: nullableCount.default(null),
  status: entityStatusSchema.default("draft"),
  priceBasis: priceBasisSchema.default("net"),
  vatPercent: vatPercentSchema.default(27),
  roomTypes: z.array(roomTypeSchema).default([]),
  packages: z.array(packageDealSchema).default([]),
});
export type AdminHotelInput = z.infer<typeof adminHotelInputSchema>;

/**
 * A sale made by a seller on-site. Unlike a console registration the
 * invoice is mandatory (the seller always hands over a paid ticket and an
 * invoice), so billing is required rather than optional, and the payment
 * can only be a method that physically happens at the counter.
 */
export const posPaymentMethods = ["cash", "card"] as const;
export const posPaymentMethodSchema = z.enum(posPaymentMethods);
export type PosPaymentMethod = z.infer<typeof posPaymentMethodSchema>;
