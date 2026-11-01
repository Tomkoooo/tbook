import { z } from "zod";
import { objectIdSchema, vatPercentSchema } from "./common";

/**
 * Products and stock ("közös raktár"). tBook is the single source of truth
 * for merchandise and its stock: the console and the point of sale sell
 * from it directly, and the webshop reads and reserves it through the
 * inventory API (docs/inventory-api.md). Invoicing, order tracking and
 * shipping for web orders stay in the webshop.
 *
 * Every sellable unit is a variant — a product without sizes simply has
 * one variant — so stock, SKUs and prices live in exactly one place.
 */

export const productStatuses = ["draft", "active", "archived"] as const;
export const productStatusSchema = z.enum(productStatuses);
export type ProductStatus = z.infer<typeof productStatusSchema>;

/** Where a product may be sold. The webshop only lists products whose channels include "webshop". */
export const salesChannels = ["pos", "webshop"] as const;
export const salesChannelSchema = z.enum(salesChannels);
export type SalesChannel = z.infer<typeof salesChannelSchema>;

/** e.g. { name: "Size", values: ["S", "M", "L"] } */
export const variantOptionSchema = z.object({
  name: z.string().trim().min(1).max(40),
  values: z.array(z.string().trim().min(1).max(40)).min(1).max(50),
});
export type VariantOption = z.infer<typeof variantOptionSchema>;

/** An uploaded image (/media/<sha256>.webp, see the blob store) or an absolute http(s) URL. */
export const productImageSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => /^https?:\/\/\S+$/.test(v) || /^\/media\/[a-f0-9]{64}\.webp$/.test(v), "Image must be an uploaded image or an http(s) URL");

/** SKU: letters, digits, dash, underscore, dot; unique within an organization. */
export const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, "SKU may contain letters, digits, '.', '_' and '-' only");

export const productVariantSchema = z.object({
  /** Stable id within the product (not the SKU, which an admin may rename). */
  id: z.string().min(1),
  sku: skuSchema,
  /** Option values, keyed by option name: { Size: "M", Color: "Black" }. Empty for a single-variant product. */
  options: z.record(z.string(), z.string()).default({}),
  /** Gross unit price; null = use the product's price. */
  priceGross: z.number().min(0).nullable().default(null),
  /** Units available to sell right now (on hand minus reserved). */
  stock: z.number().int().min(0).default(0),
  /** Units held by open reservations (e.g. webshop carts in checkout). On hand = stock + reserved. */
  reserved: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});
export type ProductVariant = z.infer<typeof productVariantSchema>;

export const productSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().default(""),
  /** Image URLs/paths, first is the main image. */
  images: z.array(productImageSchema).default([]),
  category: z.string().default(""),
  status: productStatusSchema.default("draft"),
  channels: z.array(salesChannelSchema).default(["pos", "webshop"]),
  currency: z.string().default("HUF"),
  priceGross: z.number().min(0),
  vatPercent: vatPercentSchema.default(27),
  variantOptions: z.array(variantOptionSchema).max(3).default([]),
  variants: z.array(productVariantSchema).min(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Product = z.infer<typeof productSchema>;

// ---- Inputs ------------------------------------------------------------------

export const productVariantInputSchema = z.object({
  /** Omit for a new variant. */
  id: z.string().min(1).optional(),
  sku: skuSchema,
  options: z.record(z.string(), z.string()).default({}),
  priceGross: z.number().min(0).nullable().default(null),
  active: z.boolean().default(true),
  /**
   * Only honoured when the variant is created. Changing stock later goes
   * through a stock adjustment, so every change is in the movement log.
   */
  initialStock: z.number().int().min(0).default(0),
});
export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;

export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** HTML from the rich text editor; sanitized on save. */
  description: z.string().max(100_000).default(""),
  images: z.array(productImageSchema).max(20).default([]),
  category: z.string().trim().max(100).default(""),
  status: productStatusSchema.default("draft"),
  channels: z.array(salesChannelSchema).min(1).default(["pos", "webshop"]),
  priceGross: z.number().min(0),
  vatPercent: vatPercentSchema.default(27),
  variantOptions: z.array(variantOptionSchema).max(3).default([]),
  variants: z.array(productVariantInputSchema).min(1).max(500),
});
export type ProductInput = z.infer<typeof productInputSchema>;

// ---- Stock movements, reservations, sales -------------------------------------

export const stockMovementTypes = [
  "initial",
  "adjustment",
  "reservation",
  "reservation_release",
  "reservation_commit",
  "sale",
  "return",
] as const;
export const stockMovementTypeSchema = z.enum(stockMovementTypes);
export type StockMovementType = z.infer<typeof stockMovementTypeSchema>;

export const stockLineInputSchema = z.object({
  sku: skuSchema,
  quantity: z.number().int().min(1).max(10_000),
});
export type StockLineInput = z.infer<typeof stockLineInputSchema>;

export const reservationStatuses = ["active", "committed", "released", "expired"] as const;
export const reservationStatusSchema = z.enum(reservationStatuses);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

export const createReservationInputSchema = z.object({
  /** The caller's own id (e.g. the webshop order/cart id). Repeating it returns the same reservation. */
  reference: z.string().trim().min(1).max(200),
  items: z.array(stockLineInputSchema).min(1).max(100),
  /** How long the hold lasts before it lapses on its own. */
  ttlSeconds: z.number().int().min(60).max(7 * 24 * 3600).default(1800),
});
export type CreateReservationInput = z.infer<typeof createReservationInputSchema>;

export const stockAdjustmentInputSchema = z.object({
  sku: skuSchema,
  /** Either set the on-hand count… */
  setOnHand: z.number().int().min(0).optional(),
  /** …or change it by a delta (positive = goods in, negative = write-off). */
  delta: z.number().int().min(-100_000).max(100_000).optional(),
  reason: z.string().trim().max(500).default(""),
  /** Makes retries safe: the same key is applied once. */
  idempotencyKey: z.string().trim().max(200).optional(),
}).refine((v) => (v.setOnHand === undefined) !== (v.delta === undefined), "Give exactly one of setOnHand or delta");
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInputSchema>;

export const directSaleInputSchema = z.object({
  /** Caller's sale id; repeating it never sells twice. */
  reference: z.string().trim().min(1).max(200),
  items: z.array(stockLineInputSchema).min(1).max(100),
});
export type DirectSaleInput = z.infer<typeof directSaleInputSchema>;

export const returnInputSchema = z.object({
  reference: z.string().trim().min(1).max(200),
  items: z.array(stockLineInputSchema).min(1).max(100),
});
export type ReturnInput = z.infer<typeof returnInputSchema>;
