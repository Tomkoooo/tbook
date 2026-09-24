import type { PriceBasis } from "@tbook/schemas";

/**
 * Ported from the legacy plugin's lib/vat.ts (toGrossHuf). Every stored
 * amount carries its own basis + VAT percent (there is no single org-wide
 * VAT rate) — this stays true in the rewrite. The legacy version rounded to
 * whole HUF; we round to 2 decimals since v2 supports non-HUF currencies.
 */
export function toGrossAmount(amount: number, basis: PriceBasis, vatPercent: number): number {
  if (basis === "gross") return round2(amount);
  return round2(amount * (1 + vatPercent / 100));
}

export function toNetAmount(amount: number, basis: PriceBasis, vatPercent: number): number {
  if (basis === "net") return round2(amount);
  return round2(amount / (1 + vatPercent / 100));
}

export interface PriceBreakdown {
  net: number;
  gross: number;
  vat: number;
}

/** Ported from the legacy grossPreview — net/gross/VAT breakdown for admin price-preview UI. */
export function priceBreakdown(amount: number, basis: PriceBasis, vatPercent: number): PriceBreakdown {
  const net = toNetAmount(amount, basis, vatPercent);
  const gross = toGrossAmount(amount, basis, vatPercent);
  return { net, gross, vat: round2(gross - net) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
