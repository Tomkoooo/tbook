import { z } from "zod";
import { entityStatusSchema, objectIdSchema, priceBasisSchema, vatPercentSchema } from "./common";
import { attendeeFieldDefSchema } from "./value-objects";

/** Ported from the legacy plugin's models/TBookEvent.ts. */

export const eventLocationSchema = z.object({
  address: z.string().default(""),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
  mapEmbedUrl: z.string().default(""),
});

export const ticketFeeModes = ["per_person", "per_booking", "per_team"] as const;
export const ticketFeeModeSchema = z.enum(ticketFeeModes);

export const registrationUnits = ["person", "team"] as const;
export const registrationUnitSchema = z.enum(registrationUnits);

export const attendeeFieldSchemaModes = ["extend", "replace"] as const;
export const attendeeFieldSchemaModeSchema = z.enum(attendeeFieldSchemaModes);

/**
 * Modern presets plus legacy darts-specific values still stored on older
 * events (under18/under18_female/women) — expanded to the modern shape at
 * read time by @tbook/domain, not migrated in the DB. Kept exactly as
 * legacy to stay backwards compatible.
 */
export const eligibilityPresets = ["none", "under18", "under18_female", "women", "custom", "form_rules"] as const;
export const eligibilityPresetSchema = z.enum(eligibilityPresets);

export const eligibilityFormRuleSchema = z.object({
  id: z.string(),
  fieldKey: z.string(),
  op: z.string(),
  value: z.string().default(""),
  message: z.string().default(""),
});

export const eligibilityFormRulesConfigSchema = z.object({
  logic: z.enum(["and", "or"]).default("and"),
  rules: z.array(eligibilityFormRuleSchema).default([]),
});

export const pricingRuleWhenValues = ["always", "with_hotel", "without_hotel", "with_package"] as const;
export const pricingRuleActionValues = [
  "set_ticket_fee",
  "adjust_ticket",
  "adjust_accommodation",
  "adjust_total",
] as const;
export const pricingRuleAmountModes = [
  "fixed",
  "per_person",
  "per_team",
  "per_team_member",
  "per_accommodation_guest",
  "percent_accommodation",
  "percent_ticket",
] as const;

export const pricingRuleSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  label: z.string().default("Ármódosítás"),
  when: z.enum(pricingRuleWhenValues),
  action: z.enum(pricingRuleActionValues),
  amount: z.number().default(0),
  amountMode: z.enum(pricingRuleAmountModes).default("fixed"),
});
export type PricingRule = z.infer<typeof pricingRuleSchema>;

export const publicListingValues = ["listed", "link_only"] as const;
export const publicListingSchema = z.enum(publicListingValues);

export const eventTDartsLinkSchema = z.object({
  enabled: z.boolean().default(false),
  tournamentCode: z.string().nullable().default(null),
});

export const eventSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema.nullable().default(null),
  groupId: objectIdSchema.nullable().default(null),
  name: z.string().min(1),
  description: z.string().default(""),
  location: eventLocationSchema.default({ address: "", lat: null, lng: null, mapEmbedUrl: "" }),
  startDate: z.date(),
  endDate: z.date(),
  startTime: z.string().nullable().default(null),
  endTime: z.string().nullable().default(null),
  salesOpensAt: z.date().nullable().default(null),
  salesClosesAt: z.date().nullable().default(null),
  currency: z.string().default("HUF"),
  ticketFeeHuf: z.number().min(0),
  ticketFeeMode: ticketFeeModeSchema.default("per_person"),
  registrationUnit: registrationUnitSchema.default("person"),
  playersPerTicket: z.number().min(1).max(100).default(1),
  teamMemberLimit: z.number().min(1).max(100).nullable().default(null),
  teamMemberFieldSchema: z.array(attendeeFieldDefSchema).default([]),
  ticketPriceBasis: priceBasisSchema.default("net"),
  ticketVatPercent: vatPercentSchema.default(27),
  capacity: z.number().nullable().default(null),
  soldGuestCount: z.number().min(0).default(0),
  heroImage: z.string().default(""),
  voucherHeaderImage: z.string().default(""),
  vouchersEnabled: z.boolean().default(true),
  attendeeFieldSchema: z.array(attendeeFieldDefSchema).default([]),
  attendeeFieldSchemaMode: attendeeFieldSchemaModeSchema.default("extend"),
  eligibilityPreset: eligibilityPresetSchema.default("none"),
  eligibilityMinAge: z.number().min(0).max(120).nullable().default(null),
  eligibilityMaxAge: z.number().min(0).max(120).nullable().default(null),
  eligibilityAllowedGenders: z.array(z.string()).default([]),
  eligibilityBirthDateFieldKey: z.string().nullable().default(null),
  eligibilityGenderFieldKey: z.string().nullable().default(null),
  eligibilityFormRules: eligibilityFormRulesConfigSchema.nullable().default(null),
  pricingRules: z.array(pricingRuleSchema).default([]),
  publicListing: publicListingSchema.default("listed"),
  tdarts: eventTDartsLinkSchema.default({ enabled: false, tournamentCode: null }),
  publicEntryList: z.boolean().default(false),
  status: entityStatusSchema.default("draft"),
  sortOrder: z.number().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Event = z.infer<typeof eventSchema>;

export const createEventInputSchema = eventSchema.pick({
  organizationId: true,
  groupId: true,
  name: true,
  startDate: true,
  endDate: true,
  ticketFeeHuf: true,
});
export type CreateEventInput = z.infer<typeof createEventInputSchema>;
