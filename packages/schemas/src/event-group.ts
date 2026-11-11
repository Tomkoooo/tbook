import { z } from "zod";
import { entityStatusSchema, objectIdSchema, priceBasisSchema, vatPercentSchema } from "./common";
import { modulesMapSchema } from "./modules";
import { attendeeFieldDefSchema, optionDefSchema } from "./value-objects";

/** Ported from the legacy plugin's models/TBookEventGroup.ts. */
export const eventGroupSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema.nullable().default(null),
  name: z.string().min(1),
  description: z.string().default(""),
  status: entityStatusSchema.default("draft"),
  defaultBookingOptions: z.array(optionDefSchema).default([]),
  defaultAttendeeFieldSchema: z.array(attendeeFieldDefSchema).default([]),
  defaultPriceBasis: priceBasisSchema.default("net"),
  defaultVatPercent: vatPercentSchema.default(27),
  listOnTBookSite: z.boolean().default(false),
  listingTitle: z.string().default(""),
  listingUrl: z.string().default(""),
  listingImage: z.string().default(""),
  defaultHeroImage: z.string().default(""),
  voucherHeaderImage: z.string().default(""),
  /** Feature modules switched on for this group's events (inside the org entitlement). */
  modules: modulesMapSchema.default({}),
  /** SHA-256 hash of the group API key; the plaintext is shown once on creation/rotation. */
  apiKeyHash: z.string().min(1),
  apiKeyHint: z.string().min(1),
  apiKeyCreatedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type EventGroup = z.infer<typeof eventGroupSchema>;

export const createEventGroupInputSchema = eventGroupSchema.pick({
  organizationId: true,
  name: true,
  description: true,
});
export type CreateEventGroupInput = z.infer<typeof createEventGroupInputSchema>;
