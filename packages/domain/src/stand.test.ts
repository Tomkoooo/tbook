import { describe, expect, it } from "vitest";
import { closingOf, expectedClosing, lineTotals, summarizeStand, type StandLine } from "./stand";

const can = (over: Partial<StandLine> = {}): StandLine => ({
  productId: "cola",
  name: "Cola",
  category: "drink",
  priceHuf: 600,
  depositHuf: 50,
  costHuf: 350,
  opening: 24,
  restocked: 12,
  soldCash: 10,
  soldCard: 6,
  internal: 2,
  internalOutside: 0,
  counted: null,
  ...over,
});

describe("stand lines", () => {
  it("calculates the closing inventory from opening, restock, sales and internal use", () => {
    expect(expectedClosing(can())).toBe(24 + 12 - 16 - 2);
    expect(closingOf(can())).toBe(18);
    expect(closingOf(can({ counted: 17 }))).toBe(17);
  });

  it("keeps the deposit out of the profit", () => {
    const t = lineTotals(can());
    expect(t.revenue).toBe(16 * 600);
    expect(t.deposit).toBe(16 * 50);
    expect(t.netRevenue).toBe(16 * 550);
    expect(t.cost).toBe(16 * 350);
    expect(t.profit).toBe(16 * (600 - 50 - 350));
    expect(t.revenueCash).toBe(6000);
    expect(t.revenueCard).toBe(3600);
  });

  it("has no profit without a purchase price, and values internal use at shelf price", () => {
    const t = lineTotals(can({ costHuf: null }));
    expect(t.profit).toBeNull();
    expect(t.internalValue).toBe(1200);
    expect(t.internalCost).toBeNull();
  });

  it("counts consumption outside the stand as internal use without touching the stand's stock", () => {
    const line = can({ internal: 2, internalOutside: 3 });
    expect(expectedClosing(line)).toBe(24 + 12 - 16 - 2);
    const t = lineTotals(line);
    expect(t.internal).toBe(5);
    expect(t.internalOutside).toBe(3);
    expect(t.internalValue).toBe(5 * 600);
    expect(t.internalCost).toBe(5 * 350);
  });

  it("reports a negative variance when fewer were counted than expected", () => {
    expect(lineTotals(can({ counted: 15 })).variance).toBe(-3);
    expect(lineTotals(can()).variance).toBe(0);
  });
});

describe("summarizeStand", () => {
  const lagos = can({ productId: "lagos", name: "Lángos", category: "food", priceHuf: 1500, depositHuf: 0, costHuf: null, opening: 10, restocked: 0, soldCash: 4, soldCard: 0, internal: 1, internalOutside: 0 });
  const day1 = { date: "2026-07-02", manual: null, lines: [can(), lagos] };
  const day2 = { date: "2026-07-03", manual: null, lines: [can({ opening: 18, restocked: 0, soldCash: 5, soldCard: 5, internal: 0 })] };

  it("adds revenue, cash/card, deposit, internal use and profit across days", () => {
    const s = summarizeStand([day2, day1]);
    expect(s.days).toBe(2);
    expect(s.revenue).toBe(16 * 600 + 4 * 1500 + 10 * 600);
    expect(s.cash).toBe(6000 + 6000 + 3000);
    expect(s.card).toBe(3600 + 3000);
    expect(s.deposit).toBe(26 * 50);
    expect(s.netRevenue).toBe(s.revenue - s.deposit);
    expect(s.internalItems).toBe(3);
    expect(s.internalValue).toBe(1200 + 1500);
    expect(s.profitComplete).toBe(false);
    expect(s.profit).toBe(26 * 200);
    expect(s.profitAfterInternal).toBe(26 * 200 - 2 * 350);
  });

  it("aggregates per product with first opening and last closing", () => {
    const cola = summarizeStand([day1, day2]).byProduct.find((p) => p.productId === "cola")!;
    expect(cola.opening).toBe(24);
    expect(cola.sold).toBe(26);
    expect(cola.closing).toBe(8);
    expect(cola.restocked).toBe(12);
  });

  it("counts a manual day's money without item sales or profit", () => {
    const s = summarizeStand([{ date: "2026-07-01", lines: [], manual: { cashHuf: 50000, cardHuf: 20000 } }, day2]);
    expect(s.manualDays).toBe(1);
    expect(s.cash).toBe(50000 + 3000);
    expect(s.card).toBe(20000 + 3000);
    expect(s.byDay[0]).toMatchObject({ manual: true, profit: null });
  });
});
