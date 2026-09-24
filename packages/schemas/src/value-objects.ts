import { z } from "zod";

/**
 * Shared value objects reused across event-group/event/hotel/booking.
 * The legacy plugin defined near-identical Mongoose sub-schemas for these
 * independently in three model files (TBookEventGroup, TBookHotel,
 * TBookEvent/TBookBooking) — defined once here instead, imported
 * everywhere (schemas AND the Mongoose sub-schemas in @tbook/db).
 */

export const optionPriceModes = ["fixed", "per_person", "per_night", "per_person_per_night", "percent"] as const;
export const optionPriceModeSchema = z.enum(optionPriceModes);
export type OptionPriceMode = z.infer<typeof optionPriceModeSchema>;

export const optionTypes = ["select", "multiselect", "number", "checkbox"] as const;
export const optionTypeSchema = z.enum(optionTypes);
export type OptionType = z.infer<typeof optionTypeSchema>;

export const optionChoiceSchema = z.object({
  value: z.string(),
  label: z.string(),
  priceHuf: z.number().default(0),
  priceMode: optionPriceModeSchema.default("fixed"),
});
export type OptionChoice = z.infer<typeof optionChoiceSchema>;

export const optionDependencySchema = z.object({
  key: z.string(),
  values: z.array(z.string()).default([]),
});
export type OptionDependency = z.infer<typeof optionDependencySchema>;

export const optionDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: optionTypeSchema,
  required: z.boolean().default(false),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).nullable().default(null),
  choices: z.array(optionChoiceSchema).optional(),
  unitPriceHuf: z.number().optional(),
  priceMode: optionPriceModeSchema.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  dependsOn: optionDependencySchema.nullable().default(null),
  sortOrder: z.number().default(0),
});
export type OptionDef = z.infer<typeof optionDefSchema>;

export const attendeeFieldTypes = ["text", "email", "phone", "number", "date", "select"] as const;
export const attendeeFieldTypeSchema = z.enum(attendeeFieldTypes);
export type AttendeeFieldType = z.infer<typeof attendeeFieldTypeSchema>;

export const attendeeFieldChoiceSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type AttendeeFieldChoice = z.infer<typeof attendeeFieldChoiceSchema>;

export const attendeeFieldDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: attendeeFieldTypeSchema,
  required: z.boolean().default(false),
  helpText: z.string().default(""),
  choices: z.array(attendeeFieldChoiceSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  sortOrder: z.number().default(0),
});
export type AttendeeFieldDef = z.infer<typeof attendeeFieldDefSchema>;

export const attendeeFieldValueSchema = z.union([z.string(), z.number()]);
export type AttendeeFieldValue = z.infer<typeof attendeeFieldValueSchema>;

export const bookingTeamMemberSchema = z.object({
  fields: z.record(z.string(), attendeeFieldValueSchema).default({}),
});
export type BookingTeamMember = z.infer<typeof bookingTeamMemberSchema>;

export const bookingAttendeeSchema = z.object({
  fields: z.record(z.string(), attendeeFieldValueSchema).default({}),
  members: z.array(bookingTeamMemberSchema).optional(),
});
export type BookingAttendee = z.infer<typeof bookingAttendeeSchema>;
