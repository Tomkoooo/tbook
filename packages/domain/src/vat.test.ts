import { describe, expect, it } from "vitest";
import { toGrossAmount, toNetAmount } from "./vat";

describe("vat", () => {
  it("applies VAT when the stored basis is net", () => {
    expect(toGrossAmount(1000, "net", 27)).toBe(1270);
  });

  it("passes gross amounts through unchanged", () => {
    expect(toGrossAmount(1270, "gross", 27)).toBe(1270);
  });

  it("derives net from gross", () => {
    expect(toNetAmount(1270, "gross", 27)).toBeCloseTo(1000, 5);
  });
});
