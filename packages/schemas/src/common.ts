import { z } from "zod";

/**
 * Shared primitives reused across every entity schema. Phase 2 will add the
 * full entity set (organization, eventGroup, event, hotel, booking, voucher,
 * orgMembership, orgRole, orgInvite) here, each in its own file, re-exported
 * from ./index.ts. Mongoose schemas in @tbook/db must stay structurally
 * aligned with the z.infer types exported here — that's the fix for the
 * old system's hand-synced Zod/Mongoose drift.
 */

export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Must be a 24-character hex Mongo ObjectId");

export const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 currency code");

export const priceBasisSchema = z.enum(["net", "gross"]);
export type PriceBasis = z.infer<typeof priceBasisSchema>;

export const vatPercentSchema = z.number().min(0).max(100);

export const entityStatusSchema = z.enum(["draft", "active", "archived"]);
export type EntityStatus = z.infer<typeof entityStatusSchema>;
