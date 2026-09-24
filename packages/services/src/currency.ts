/** Ported from the legacy plugin's lib/currency.ts (normalization subset only — Stripe-specific helpers already live in checkout-service.ts). */

export const DEFAULT_TBOOK_CURRENCY = "HUF" as const;

const KNOWN_CURRENCIES = new Set(["HUF", "EUR", "USD", "GBP", "CHF", "CZK", "PLN", "RON"]);

export function normalizeTBookCurrency(raw: string | null | undefined): string {
  const code = String(raw ?? "")
    .trim()
    .toUpperCase();
  return KNOWN_CURRENCIES.has(code) ? code : DEFAULT_TBOOK_CURRENCY;
}
