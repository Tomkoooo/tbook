import { describe, expect, it } from "vitest";
import { currencySchema, objectIdSchema, priceBasisSchema } from "./common";

describe("common schemas", () => {
  it("accepts a valid ObjectId", () => {
    expect(objectIdSchema.safeParse("6a574d05da17ae33cc2b5517").success).toBe(true);
  });

  it("rejects an invalid ObjectId", () => {
    expect(objectIdSchema.safeParse("not-an-id").success).toBe(false);
  });

  it("accepts a valid ISO currency code", () => {
    expect(currencySchema.safeParse("HUF").success).toBe(true);
  });

  it("restricts price basis to net or gross", () => {
    expect(priceBasisSchema.safeParse("net").success).toBe(true);
    expect(priceBasisSchema.safeParse("half").success).toBe(false);
  });
});
