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

/**
 * `checkbox` stores "true" when ticked (a required checkbox must be ticked —
 * a consent box). `textarea` is free text shown as a multi-line input.
 */
export const attendeeFieldTypes = ["text", "email", "phone", "number", "date", "select", "checkbox", "textarea"] as const;
export const attendeeFieldTypeSchema = z.enum(attendeeFieldTypes);
export type AttendeeFieldType = z.infer<typeof attendeeFieldTypeSchema>;

export const attendeeFieldChoiceSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type AttendeeFieldChoice = z.infer<typeof attendeeFieldChoiceSchema>;

/** Show a field only when another field has one of these values (same shape as an option's `dependsOn`). */
export const attendeeFieldShowWhenSchema = z.object({
  fieldKey: z.string().min(1),
  values: z.array(z.string()).default([]),
});
export type AttendeeFieldShowWhen = z.infer<typeof attendeeFieldShowWhenSchema>;

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
  /** Hidden (not asked, not required, not stored) unless the condition holds. */
  showWhen: attendeeFieldShowWhenSchema.nullable().optional(),
  /** One active registration per value within the event (e.g. an employee ID). */
  unique: z.boolean().optional(),
  /** Guests and staff can find a registration by this value (door search, guest lookup). */
  identifier: z.boolean().optional(),
  /**
   * A select whose choices come from a module at request time instead of
   * `choices` (e.g. "bus-transport:routes"). Null = static choices.
   */
  choicesSource: z.string().max(100).nullable().optional(),
  /**
   * Prefill: when the guest starts with their identifying answer (e.g.
   * employee ID), this answer is copied from that column of the data list
   * the identifying field is checked against (`in_list` rule). The guest may
   * still change it. Null = not prefilled.
   */
  prefillColumn: z.string().max(200).nullable().optional(),
});
export type AttendeeFieldDef = z.infer<typeof attendeeFieldDefSchema>;

export const attendeeFieldValueSchema = z.union([z.string(), z.number()]);
export type AttendeeFieldValue = z.infer<typeof attendeeFieldValueSchema>;

export const bookingTeamMemberSchema = z.object({
  fields: z.record(z.string(), attendeeFieldValueSchema).default({}),
});
export type BookingTeamMember = z.infer<typeof bookingTeamMemberSchema>;

export const bookingAttendeeSchema = z.object({
  /** Stable id (absent on bookings created before it existed). Modules refer to an attendee by it. */
  id: z.string().optional(),
  /** Short human code printed on the confirmation and ticket, e.g. "HU7K3M9Q". */
  registrationNumber: z.string().optional(),
  fields: z.record(z.string(), attendeeFieldValueSchema).default({}),
  members: z.array(bookingTeamMemberSchema).optional(),
  /** Labels organizers put on a guest (e.g. "VIP"), shown at check-in. */
  tags: z.array(z.string()).optional(),
});
export type BookingAttendee = z.infer<typeof bookingAttendeeSchema>;
