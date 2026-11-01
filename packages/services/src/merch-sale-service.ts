import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { MerchSaleModel, type IMerchSale } from "@tbook/db";
import { resolveVariantPrice, variantLabel } from "@tbook/domain";
import type { StockLineInput } from "@tbook/schemas";
import { recordSale, resolveSkus } from "./inventory-service";
import { fetchReceiptPdf, issueReceiptDocument, type SzamlazzReceiptProvider } from "./receipt-service";

/**
 * Merchandise sold at the counter. Stock leaves the shared warehouse
 * (inventory-service) — the same stock the webshop sells from — and a
 * Számlázz.hu receipt is issued for printing.
 *
 * Card payments are taken on a standalone terminal (e.g. myPOS): the
 * seller keys the amount into the terminal and records the slip number
 * here. Nothing is sent to the customer.
 */

export interface MerchSaleInput {
  lines: StockLineInput[];
  paymentMethod: "cash" | "card";
  paymentReference?: string;
}

export interface MerchSaleView {
  id: string;
  createdAt: string;
  lines: Array<{ sku: string; name: string; variantLabel: string; quantity: number; unitPriceGross: number; lineTotal: number }>;
  totalGross: number;
  currency: string;
  paymentMethod: "cash" | "card";
  paymentReference: string;
  receipt: { status: string; number: string | null; error: string | null; hasPdf: boolean };
}

function toView(sale: IMerchSale): MerchSaleView {
  return {
    id: String(sale._id),
    createdAt: sale.createdAt.toISOString(),
    lines: sale.lines.map((line) => ({
      sku: line.sku,
      name: line.name,
      variantLabel: line.variantLabel,
      quantity: line.quantity,
      unitPriceGross: line.unitPriceGross,
      lineTotal: line.unitPriceGross * line.quantity,
    })),
    totalGross: sale.totalGross,
    currency: sale.currency,
    paymentMethod: sale.paymentMethod,
    paymentReference: sale.paymentReference,
    receipt: {
      status: sale.receipt?.status ?? "none",
      number: sale.receipt?.number ?? null,
      error: sale.receipt?.error ?? null,
      // Issued receipts are always printable (fetched from Számlázz.hu on demand).
      hasPdf: sale.receipt?.status === "issued",
    },
  };
}

async function issueMerchReceipt(sale: IMerchSale, provider?: SzamlazzReceiptProvider): Promise<void> {
  const id = String(sale._id);
  try {
    const { number } = await issueReceiptDocument(
      String(sale.organizationId),
      {
        items: sale.lines.map((line) => ({
          label: line.variantLabel ? `${line.name} (${line.variantLabel})` : line.name,
          quantity: line.quantity,
          unit: "db",
          vatPercent: line.vatPercent,
          grossUnitPrice: line.unitPriceGross,
        })),
        paymentMethod: sale.paymentMethod,
        callId: `tbook-merch-${id}`,
        currency: sale.currency,
      },
      provider,
    );
    await MerchSaleModel.updateOne({ _id: sale._id }, { $set: { receipt: { status: "issued", number, pdfFileName: null, error: null, issuedAt: new Date() } } }).exec();
  } catch (error) {
    await MerchSaleModel.updateOne(
      { _id: sale._id },
      { $set: { receipt: { status: "failed", number: null, pdfFileName: null, error: error instanceof Error ? error.message : "Receipt issuance failed.", issuedAt: null } } },
    ).exec();
  }
}

export async function createMerchSale(
  organizationId: string,
  input: MerchSaleInput,
  actor: { userId: string | null },
  opts: { provider?: SzamlazzReceiptProvider } = {},
): Promise<MerchSaleView> {
  if (input.lines.length === 0) throw ActionError.validation("The cart is empty.");

  // Prices come from the catalog, never from the client.
  const found = await resolveSkus(organizationId, input.lines.map((l) => l.sku));
  const quantities = new Map<string, number>();
  for (const line of input.lines) quantities.set(line.sku.trim().toUpperCase(), (quantities.get(line.sku.trim().toUpperCase()) ?? 0) + line.quantity);

  const lines = [...quantities.entries()].map(([sku, quantity]) => {
    const { product, variantIndex } = found.get(sku)!;
    const variant = product.variants[variantIndex]!;
    if (product.status !== "active" || !product.channels.includes("pos") || !variant.active) {
      throw ActionError.validation(`${product.name} (${variant.sku}) is not on sale at the counter.`);
    }
    return {
      productId: product._id as Types.ObjectId,
      variantId: variant.id,
      sku: variant.sku,
      name: product.name,
      variantLabel: variantLabel(variant.options ?? {}, product.variantOptions),
      quantity,
      unitPriceGross: resolveVariantPrice(product.priceGross, variant.priceGross),
      vatPercent: product.vatPercent,
      currency: product.currency,
    };
  });
  const currencies = new Set(lines.map((l) => l.currency));
  if (currencies.size > 1) throw ActionError.validation("Items in one sale must share a currency.");

  const saleId = new Types.ObjectId();
  // Takes the stock first (all-or-nothing); a shortage stops the sale before anything is recorded.
  await recordSale(organizationId, { reference: `pos-merch:${saleId}`, items: lines.map((l) => ({ sku: l.sku, quantity: l.quantity })) }, "pos");

  const sale = await MerchSaleModel.create({
    _id: saleId,
    organizationId: new Types.ObjectId(organizationId),
    lines: lines.map(({ currency: _currency, ...line }) => line),
    totalGross: lines.reduce((sum, l) => sum + l.unitPriceGross * l.quantity, 0),
    currency: lines[0]!.currency,
    paymentMethod: input.paymentMethod,
    paymentReference: input.paymentReference?.trim() ?? "",
    receipt: { status: "pending", number: null, pdfFileName: null, error: null, issuedAt: null },
    createdByUserId: actor.userId,
  });

  await issueMerchReceipt(sale, opts.provider);
  return getMerchSale(organizationId, String(saleId));
}

async function findSale(organizationId: string, saleId: string): Promise<IMerchSale> {
  if (!Types.ObjectId.isValid(saleId)) throw ActionError.notFound("Sale not found");
  const sale = await MerchSaleModel.findOne({ _id: saleId, organizationId: new Types.ObjectId(organizationId) }).exec();
  if (!sale) throw ActionError.notFound("Sale not found");
  return sale;
}

export async function getMerchSale(organizationId: string, saleId: string): Promise<MerchSaleView> {
  return toView(await findSale(organizationId, saleId));
}

export async function listMerchSales(organizationId: string, limit = 50): Promise<MerchSaleView[]> {
  const sales = await MerchSaleModel.find({ organizationId: new Types.ObjectId(organizationId) })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .exec();
  return sales.map(toView);
}

/** Retries a failed receipt (network error, settings fixed). Never issues a second receipt. */
export async function retryMerchReceipt(organizationId: string, saleId: string, opts: { provider?: SzamlazzReceiptProvider } = {}): Promise<MerchSaleView> {
  const sale = await findSale(organizationId, saleId);
  if (sale.receipt?.status !== "issued") await issueMerchReceipt(sale, opts.provider);
  return getMerchSale(organizationId, saleId);
}

export async function getMerchReceiptPdf(
  organizationId: string,
  saleId: string,
  provider?: SzamlazzReceiptProvider,
): Promise<{ pdf: Buffer; number: string } | null> {
  const sale = await findSale(organizationId, saleId);
  if (sale.receipt?.status !== "issued" || !sale.receipt.number) return null;
  return { pdf: await fetchReceiptPdf(organizationId, sale.receipt, provider), number: sale.receipt.number };
}
