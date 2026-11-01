import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { ProductModel, organizationRepository, type IProduct, type IProductVariant } from "@tbook/db";
import { resolveVariantPrice, validateProductVariants, variantLabel } from "@tbook/domain";
import type { ProductInput, ProductStatus, SalesChannel } from "@tbook/schemas";
import { logInitialStock } from "./inventory-service";
import { isOwnProductImage } from "./product-media-service";
import { sanitizeRichText } from "./rich-text";

/**
 * Product catalog for merchandise. Products are org-scoped; every sellable
 * unit is a variant with its own SKU, price override and stock (see
 * inventory-service.ts for how stock moves).
 */

export interface ProductVariantView {
  id: string;
  sku: string;
  options: Record<string, string>;
  label: string;
  priceGross: number;
  /** priceGross without VAT, rounded to 2 decimals. */
  priceNet: number;
  /** null when the variant inherits the product price. */
  ownPriceGross: number | null;
  available: number;
  reserved: number;
  onHand: number;
  active: boolean;
}

export interface ProductView {
  id: string;
  name: string;
  description: string;
  images: string[];
  category: string;
  status: ProductStatus;
  channels: SalesChannel[];
  currency: string;
  priceGross: number;
  priceNet: number;
  vatPercent: number;
  variantOptions: Array<{ name: string; values: string[] }>;
  variants: ProductVariantView[];
  totalAvailable: number;
  createdAt: string;
  updatedAt: string;
}

const netOf = (gross: number, vatPercent: number) => Math.round((gross / (1 + vatPercent / 100)) * 100) / 100;

export function toProductView(product: IProduct): ProductView {
  const variants = product.variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    options: { ...(variant.options ?? {}) },
    label: variantLabel(variant.options ?? {}, product.variantOptions),
    priceGross: resolveVariantPrice(product.priceGross, variant.priceGross),
    priceNet: netOf(resolveVariantPrice(product.priceGross, variant.priceGross), product.vatPercent),
    ownPriceGross: variant.priceGross ?? null,
    available: variant.stock,
    reserved: variant.reserved,
    onHand: variant.stock + variant.reserved,
    active: variant.active,
  }));
  return {
    id: String(product._id),
    name: product.name,
    description: product.description,
    images: [...product.images],
    category: product.category,
    status: product.status,
    channels: [...product.channels],
    currency: product.currency,
    priceGross: product.priceGross,
    priceNet: netOf(product.priceGross, product.vatPercent),
    vatPercent: product.vatPercent,
    variantOptions: product.variantOptions.map((o) => ({ name: o.name, values: [...o.values] })),
    variants,
    totalAvailable: variants.filter((v) => v.active).reduce((sum, v) => sum + v.available, 0),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export interface ProductListFilter {
  status?: ProductStatus | ProductStatus[];
  channel?: SalesChannel;
  category?: string;
  search?: string;
  /** Only products with at least one active variant in stock. */
  inStock?: boolean;
}

export async function listProducts(organizationId: string, filter: ProductListFilter = {}): Promise<ProductView[]> {
  const query: Record<string, unknown> = { organizationId: new Types.ObjectId(organizationId) };
  if (filter.status) query.status = Array.isArray(filter.status) ? { $in: filter.status } : filter.status;
  if (filter.channel) query.channels = filter.channel;
  if (filter.category) query.category = filter.category;
  if (filter.search?.trim()) {
    const pattern = new RegExp(filter.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ name: pattern }, { "variants.sku": pattern }, { category: pattern }];
  }
  const products = await ProductModel.find(query).sort({ name: 1 }).exec();
  const views = products.map(toProductView);
  return filter.inStock ? views.filter((p) => p.totalAvailable > 0) : views;
}

export async function getProduct(organizationId: string, productId: string): Promise<ProductView> {
  if (!Types.ObjectId.isValid(productId)) throw ActionError.notFound("Product not found");
  const product = await ProductModel.findOne({ _id: productId, organizationId: new Types.ObjectId(organizationId) }).exec();
  if (!product) throw ActionError.notFound("Product not found");
  return toProductView(product);
}

/**
 * Creates (productId = null) or updates a product.
 *
 * Existing variants are matched by id and keep their stock and
 * reservations; stock is never edited here (that's a stock adjustment, so
 * it is logged). New variants start at `initialStock`. A variant that
 * still has stock or open reservations can't be removed — deactivate it.
 */
export async function saveProduct(organizationId: string, productId: string | null, input: ProductInput, actor: string): Promise<ProductView> {
  const org = await organizationRepository.findById(organizationId);
  if (!org) throw ActionError.notFound("Organization not found");

  const variantsInput = input.variants.map((v) => ({ ...v, sku: v.sku.trim().toUpperCase() }));
  const problems = validateProductVariants(input.variantOptions, variantsInput);
  if (problems.length > 0) throw ActionError.validation(problems.join(" "), { problems });

  const existing = productId
    ? await ProductModel.findOne({ _id: productId, organizationId: new Types.ObjectId(organizationId) }).exec()
    : null;
  if (productId && !existing) throw ActionError.notFound("Product not found");

  // SKUs are unique across the whole organization (the API addresses stock by SKU).
  const clash = await ProductModel.findOne({
    organizationId: new Types.ObjectId(organizationId),
    ...(existing ? { _id: { $ne: existing._id } } : {}),
    "variants.sku": { $in: variantsInput.map((v) => v.sku) },
  }).exec();
  if (clash) {
    const taken = clash.variants.map((v) => v.sku).filter((sku) => variantsInput.some((v) => v.sku === sku));
    throw ActionError.conflict(`SKU already used by "${clash.name}": ${taken.join(", ")}`, "sku_taken", { skus: taken });
  }

  const previous = new Map((existing?.variants ?? []).map((v) => [v.id, v]));
  const created: Array<{ variantId: string; sku: string; quantity: number }> = [];
  const variants: IProductVariant[] = variantsInput.map((v) => {
    const before = v.id ? previous.get(v.id) : undefined;
    if (v.id && !before) throw ActionError.validation(`Unknown variant id ${v.id}.`);
    if (before) {
      return { id: before.id, sku: v.sku, options: v.options, priceGross: v.priceGross, stock: before.stock, reserved: before.reserved, active: v.active };
    }
    const id = randomUUID();
    created.push({ variantId: id, sku: v.sku, quantity: v.initialStock });
    return { id, sku: v.sku, options: v.options, priceGross: v.priceGross, stock: v.initialStock, reserved: 0, active: v.active };
  });

  const kept = new Set(variants.map((v) => v.id));
  const removed = [...previous.values()].filter((v) => !kept.has(v.id));
  const blocked = removed.filter((v) => v.stock > 0 || v.reserved > 0);
  if (blocked.length > 0) {
    throw ActionError.validation(
      `Can't delete ${blocked.map((v) => v.sku).join(", ")}: still in stock or reserved. Set the stock to 0 or make the variant inactive instead.`,
    );
  }

  const uploaded = input.images.filter((image) => image.startsWith("/media/"));
  const owned = await Promise.all(uploaded.map((image) => isOwnProductImage(organizationId, image)));
  if (owned.includes(false)) throw ActionError.validation("Images must be uploaded to this organization.");

  const fields = {
    name: input.name.trim(),
    description: sanitizeRichText(input.description),
    images: input.images,
    category: input.category.trim(),
    status: input.status,
    channels: [...new Set(input.channels)],
    currency: org.settings?.currency ?? "HUF",
    priceGross: input.priceGross,
    vatPercent: input.vatPercent,
    variantOptions: input.variantOptions,
  };

  let saved: IProduct | null;
  if (existing) {
    // The editor never changes stock, so carry over the live counters, and
    // only write if nothing (e.g. a sale) touched the product since that
    // read — otherwise the sale's stock change would be overwritten.
    const live = await ProductModel.findById(existing._id).exec();
    const liveById = new Map((live?.variants ?? []).map((v) => [v.id, v]));
    for (const variant of variants) {
      const now = liveById.get(variant.id);
      if (now) {
        variant.stock = now.stock;
        variant.reserved = now.reserved;
      }
    }
    saved = await ProductModel.findOneAndUpdate(
      { _id: existing._id, updatedAt: live?.updatedAt ?? existing.updatedAt },
      { $set: { ...fields, variants } },
      { returnDocument: "after" },
    ).exec();
    if (!saved) throw ActionError.conflict("The product changed while you were editing (e.g. a sale). Reload and save again.", "concurrent_update");
  } else {
    saved = await ProductModel.create({ organizationId: new Types.ObjectId(organizationId), ...fields, variants });
  }

  await logInitialStock(
    organizationId,
    created.map((c) => ({ productId: saved._id as Types.ObjectId, variantId: c.variantId, sku: c.sku, quantity: c.quantity })),
    actor,
  );
  return toProductView(saved);
}

export async function setProductStatus(organizationId: string, productId: string, status: ProductStatus): Promise<void> {
  const result = await ProductModel.updateOne({ _id: productId, organizationId: new Types.ObjectId(organizationId) }, { $set: { status } }).exec();
  if (result.matchedCount === 0) throw ActionError.notFound("Product not found");
}

export async function listProductCategories(organizationId: string): Promise<string[]> {
  const categories = await ProductModel.distinct("category", { organizationId: new Types.ObjectId(organizationId) }).exec();
  return categories.filter((c): c is string => Boolean(c)).sort((a, b) => a.localeCompare(b));
}
