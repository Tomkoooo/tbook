"use server";

import { revalidatePath } from "next/cache";
import { ActionError, parseInput } from "@tbook/actions";
import {
  adjustStock,
  createMerchSale,
  retryMerchReceipt,
  revokeInventoryApiKey,
  rotateInventoryApiKey,
  saveProduct,
  setProductStatus,
  type MerchSaleView,
  type ProductView,
} from "@tbook/services";
import { productInputSchema, productStatusSchema, stockAdjustmentInputSchema, stockLineInputSchema, type Permission } from "@tbook/schemas";
import { z } from "zod";
import { getSessionUser, requireOrgPermission } from "@/lib/admin-auth";

/**
 * Server actions for products, stock, the inventory API key and merch
 * sales at the counter. Same contract as the other action files: re-check
 * the permission here, return a plain result for inline display.
 */

export interface ProductActionResult {
  ok: boolean;
  message?: string;
  product?: ProductView;
  sale?: MerchSaleView;
  /** Shown once, when the inventory API key is created. */
  apiKey?: string;
}

function fail(error: unknown, label: string): ProductActionResult {
  if (error instanceof ActionError) {
    const problems = (error.details as { problems?: string[] } | undefined)?.problems;
    return { ok: false, message: problems?.length ? problems.join(" ") : error.message };
  }
  console.error(`[${label}]`, error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

/** First permission that succeeds; roles that predate a permission fall back to the older one. */
async function requireAny(...permissions: Permission[]) {
  let last: unknown;
  for (const permission of permissions) {
    try {
      return await requireOrgPermission(permission);
    } catch (error) {
      if (!(error instanceof ActionError) || error.status !== 403) throw error;
      last = error;
    }
  }
  throw last;
}

function parseJson(formData: FormData, key: string): unknown {
  try {
    return JSON.parse(String(formData.get(key) ?? ""));
  } catch {
    throw ActionError.validation("Could not read the form.");
  }
}

export async function saveProductAction(productId: string | null, formData: FormData): Promise<ProductActionResult> {
  try {
    const { organizationId, userId } = await requireAny("product:write", "event:write");
    const input = parseInput(productInputSchema, parseJson(formData, "payload"));
    const product = await saveProduct(organizationId, productId, input, userId);
    revalidatePath("/admin/products");
    return { ok: true, message: productId ? "Product saved." : "Product created.", product };
  } catch (error) {
    return fail(error, "save product");
  }
}

export async function setProductStatusAction(productId: string, status: string): Promise<ProductActionResult> {
  try {
    const { organizationId } = await requireAny("product:write", "event:write");
    await setProductStatus(organizationId, productId, productStatusSchema.parse(status));
    revalidatePath("/admin/products");
    return { ok: true, message: `Product is now ${status}.` };
  } catch (error) {
    return fail(error, "product status");
  }
}

export async function adjustStockAction(formData: FormData): Promise<ProductActionResult> {
  try {
    const { organizationId, userId } = await requireAny("product:write", "event:write");
    const mode = String(formData.get("mode") ?? "delta");
    const amount = Number(formData.get("amount"));
    if (!Number.isFinite(amount)) throw ActionError.validation("Enter a number.");
    const input = parseInput(stockAdjustmentInputSchema, {
      sku: String(formData.get("sku") ?? ""),
      ...(mode === "set" ? { setOnHand: amount } : { delta: amount }),
      reason: String(formData.get("reason") ?? ""),
    });
    const level = await adjustStock(organizationId, input, userId);
    revalidatePath("/admin/products");
    return { ok: true, message: `${level.sku}: ${level.onHand} on hand, ${level.available} available.` };
  } catch (error) {
    return fail(error, "adjust stock");
  }
}

export async function rotateInventoryKeyAction(): Promise<ProductActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("org:update");
    const { plaintext } = await rotateInventoryApiKey(organizationId);
    revalidatePath("/admin/integrations");
    return { ok: true, message: "New key created. The previous key no longer works.", apiKey: plaintext };
  } catch (error) {
    return fail(error, "rotate inventory key");
  }
}

export async function revokeInventoryKeyAction(): Promise<ProductActionResult> {
  try {
    const { organizationId } = await requireOrgPermission("org:update");
    await revokeInventoryApiKey(organizationId);
    revalidatePath("/admin/integrations");
    return { ok: true, message: "Key revoked. The webshop can no longer reach the inventory." };
  } catch (error) {
    return fail(error, "revoke inventory key");
  }
}

const merchSaleSchema = z.object({
  lines: z.array(stockLineInputSchema).min(1, "The cart is empty."),
  paymentMethod: z.enum(["cash", "card"]),
  paymentReference: z.string().max(200).default(""),
});

export async function createMerchSaleAction(formData: FormData): Promise<ProductActionResult> {
  try {
    const { organizationId } = await requireAny("sale:create", "booking:manage");
    const user = await getSessionUser();
    const input = parseInput(merchSaleSchema, parseJson(formData, "payload"));
    const sale = await createMerchSale(organizationId, input, { userId: user?.id ?? null });
    revalidatePath("/admin/products");
    return { ok: true, sale };
  } catch (error) {
    return fail(error, "merch sale");
  }
}

export async function retryMerchReceiptAction(saleId: string): Promise<ProductActionResult> {
  try {
    const { organizationId } = await requireAny("sale:create", "booking:manage");
    const sale = await retryMerchReceipt(organizationId, saleId);
    return sale.receipt.status === "issued"
      ? { ok: true, sale, message: `Receipt ${sale.receipt.number} issued.` }
      : { ok: false, sale, message: sale.receipt.error ?? "The receipt could not be issued." };
  } catch (error) {
    return fail(error, "merch receipt retry");
  }
}
