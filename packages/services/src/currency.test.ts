import { describe, expect, it } from "vitest";
import { DEFAULT_TBOOK_CURRENCY, normalizeTBookCurrency } from "./currency";

describe("normalizeTBookCurrency", () => {
  it("passes through a known code", () => {
    expect(normalizeTBookCurrency("eur")).toBe("EUR");
  });

  it("falls back to the default for unknown/missing input", () => {
    expect(normalizeTBookCurrency("xyz")).toBe(DEFAULT_TBOOK_CURRENCY);
    expect(normalizeTBookCurrency(null)).toBe(DEFAULT_TBOOK_CURRENCY);
    expect(normalizeTBookCurrency(undefined)).toBe(DEFAULT_TBOOK_CURRENCY);
  });
});
