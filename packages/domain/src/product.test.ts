import { describe, expect, it } from "vitest";
import { optionKey, suggestSku, validateProductVariants, variantCombinations, variantLabel } from "./product";

const options = [
  { name: "Size", values: ["S", "M"] },
  { name: "Color", values: ["Fekete", "Fehér"] },
];

describe("product variants", () => {
  it("builds every combination in option order", () => {
    expect(variantCombinations(options)).toEqual([
      { Size: "S", Color: "Fekete" },
      { Size: "S", Color: "Fehér" },
      { Size: "M", Color: "Fekete" },
      { Size: "M", Color: "Fehér" },
    ]);
    expect(variantCombinations([])).toEqual([{}]);
  });

  it("labels, keys and suggests SKUs", () => {
    expect(variantLabel({ Color: "Fehér", Size: "M" }, options)).toBe("M · Fehér");
    expect(optionKey({ b: "2", a: "1" })).toBe(optionKey({ a: "1", b: "2" }));
    expect(suggestSku("Póló 2026", { Size: "XL", Color: "Fehér" })).toBe("POLO-2026-XL-FEHER");
  });

  it("validates variants against the options", () => {
    expect(validateProductVariants(options, [{ sku: "A", options: { Size: "S", Color: "Fekete" } }])).toEqual([]);
    const problems = validateProductVariants(options, [
      { sku: "A", options: { Size: "S", Color: "Fekete" } },
      { sku: "a", options: { Size: "S", Color: "Fekete" } },
      { sku: "B", options: { Size: "XXL", Color: "Fekete" } },
      { sku: "C", options: { Size: "S" } },
    ]);
    expect(problems.join("\n")).toMatch(/SKU a is used twice/);
    expect(problems.join("\n")).toMatch(/same options/);
    expect(problems.join("\n")).toMatch(/"XXL" is not a Size value/);
    expect(problems.join("\n")).toMatch(/must set exactly: Size, Color/);
    expect(validateProductVariants([], [{ sku: "A", options: {} }, { sku: "B", options: {} }])).toHaveLength(1);
  });
});
