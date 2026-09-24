import { describe, expect, it } from "vitest";
import { buildInvoiceLineItems, resolveSupportedInvoiceCurrency, vatForQuoteLine } from "./invoice-service";

describe("vatForQuoteLine", () => {
  it("uses accommodation VAT for the accommodation base line", () => {
    expect(vatForQuoteLine("accommodation_base", 27, 5)).toBe(5);
  });

  it("uses accommodation VAT for package and option lines", () => {
    expect(vatForQuoteLine("package_unit:std", 27, 5)).toBe(5);
    expect(vatForQuoteLine("option:breakfast", 27, 5)).toBe(5);
  });

  it("uses ticket VAT for the ticket line and everything else", () => {
    expect(vatForQuoteLine("ticket", 27, 5)).toBe(27);
    expect(vatForQuoteLine("pricing_rule:early_bird", 27, 5)).toBe(27);
  });
});

describe("buildInvoiceLineItems", () => {
  it("maps positive-amount quote lines to invoice items with resolved VAT", () => {
    const items = buildInvoiceLineItems(
      { quote: { lines: [{ key: "ticket", label: "Entry × 2", amountHuf: 10_000 }, { key: "accommodation_base", label: "Room", amountHuf: 5000 }] } } as never,
      { ticketVatPercent: 27, accommodationVatPercent: 18 },
    );
    expect(items).toEqual([
      { label: "Entry × 2", quantity: 1, unit: "db", vatPercent: 27, grossUnitPrice: 10_000 },
      { label: "Room", quantity: 1, unit: "db", vatPercent: 18, grossUnitPrice: 5000 },
    ]);
  });

  it("drops zero/negative-amount lines (e.g. a discount rendered as its own line)", () => {
    const items = buildInvoiceLineItems(
      { quote: { lines: [{ key: "ticket", label: "Entry", amountHuf: 10_000 }, { key: "pricing_rule:discount", label: "Discount", amountHuf: -1000 }] } } as never,
      { ticketVatPercent: 27, accommodationVatPercent: 27 },
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("Entry");
  });
});

describe("resolveSupportedInvoiceCurrency", () => {
  it("accepts HUF and EUR case-insensitively", () => {
    expect(resolveSupportedInvoiceCurrency("huf")).toBe("HUF");
    expect(resolveSupportedInvoiceCurrency("EUR")).toBe("EUR");
  });

  it("rejects unsupported currencies", () => {
    expect(resolveSupportedInvoiceCurrency("USD")).toBeNull();
  });

  it("defaults a missing currency to HUF (bookings always have a currency in practice; matches the schema's own default)", () => {
    expect(resolveSupportedInvoiceCurrency(null)).toBe("HUF");
    expect(resolveSupportedInvoiceCurrency(undefined)).toBe("HUF");
  });
});
