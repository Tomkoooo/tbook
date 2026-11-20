/**
 * Stand mode arithmetic: one product's line on a stand day, and the totals
 * over many days. Pure — no I/O.
 *
 * Money is whole forints, gross. `priceHuf` is the shelf price and already
 * contains `depositHuf` (visszaváltási érték) — the refundable can/bottle
 * deposit. The deposit is paid to the supplier and returned to the guest, so
 * it is never profit: net revenue = revenue − deposit. `costHuf` is the
 * purchase price per unit WITHOUT the deposit (null = not known).
 */

export interface StandLine {
  productId: string;
  name: string;
  category: "drink" | "food";
  priceHuf: number;
  depositHuf: number;
  costHuf: number | null;
  opening: number;
  restocked: number;
  soldCash: number;
  soldCard: number;
  /** Belső fogyasztás from the stand's stock: consumed by the team, not sold; reduces the stand's inventory. */
  internal: number;
  /** Belső fogyasztás outside the stand (not taken from its stock): counts as internal use, leaves the inventory alone. */
  internalOutside: number;
  /** The closing count entered by hand; null = trust the calculation. */
  counted: number | null;
}

export interface StandDayData {
  date: string;
  lines: StandLine[];
  /** A day recorded after the fact: only the money, no item sales. */
  manual: { cashHuf: number; cardHuf: number } | null;
}

export function expectedClosing(line: Pick<StandLine, "opening" | "restocked" | "soldCash" | "soldCard" | "internal">): number {
  return line.opening + line.restocked - line.soldCash - line.soldCard - line.internal;
}

/** What tomorrow starts with: the count if there is one, else the calculation. */
export function closingOf(line: StandLine): number {
  return line.counted ?? expectedClosing(line);
}

export interface LineTotals {
  sold: number;
  revenueCash: number;
  revenueCard: number;
  revenue: number;
  deposit: number;
  netRevenue: number;
  /** Purchase cost of what was sold; null when the price isn't known. */
  cost: number | null;
  /** Net revenue − cost; null when the cost isn't known. */
  profit: number | null;
  /** All internal use: from the stand plus outside it. */
  internal: number;
  internalOutside: number;
  /** All internal use at shelf price. */
  internalValue: number;
  internalCost: number | null;
  /** counted − expected; 0 when not counted. Negative = missing. */
  variance: number;
  varianceValue: number;
}

export function lineTotals(line: StandLine): LineTotals {
  const sold = line.soldCash + line.soldCard;
  const internalAll = line.internal + line.internalOutside;
  const revenue = sold * line.priceHuf;
  const deposit = sold * line.depositHuf;
  const cost = line.costHuf === null ? null : sold * line.costHuf;
  const variance = line.counted === null ? 0 : line.counted - expectedClosing(line);
  return {
    sold,
    revenueCash: line.soldCash * line.priceHuf,
    revenueCard: line.soldCard * line.priceHuf,
    revenue,
    deposit,
    netRevenue: revenue - deposit,
    cost,
    profit: cost === null ? null : revenue - deposit - cost,
    internal: internalAll,
    internalOutside: line.internalOutside,
    internalValue: internalAll * line.priceHuf,
    internalCost: line.costHuf === null ? null : internalAll * line.costHuf,
    variance,
    varianceValue: variance * (line.costHuf ?? line.priceHuf - line.depositHuf),
  };
}

export interface StandProductRow {
  productId: string;
  name: string;
  category: "drink" | "food";
  /** First day's opening in the range. */
  opening: number;
  restocked: number;
  sold: number;
  soldCash: number;
  soldCard: number;
  /** All internal use (from the stand + outside). */
  internal: number;
  internalOutside: number;
  /** Last day's closing in the range. */
  closing: number;
  revenue: number;
  deposit: number;
  cost: number | null;
  profit: number | null;
  internalValue: number;
  variance: number;
}

export interface StandDayRow {
  date: string;
  manual: boolean;
  revenue: number;
  cash: number;
  card: number;
  deposit: number;
  profit: number | null;
  internalValue: number;
  itemsSold: number;
  internalItems: number;
  internalOutsideItems: number;
}

export interface StandSummary {
  days: number;
  manualDays: number;
  revenue: number;
  cash: number;
  card: number;
  deposit: number;
  netRevenue: number;
  itemsSold: number;
  /** Cost of the sold items whose purchase price is known. */
  cost: number;
  /** Net revenue − cost, over items with a known price only. */
  profit: number;
  /** True when every sold item has a purchase price, so `profit` is complete. */
  profitComplete: boolean;
  internalItems: number;
  /** Of internalItems, the part consumed outside the stand. */
  internalOutsideItems: number;
  internalValue: number;
  internalCost: number;
  /** Profit after the cost of internal use. */
  profitAfterInternal: number;
  variance: number;
  varianceValue: number;
  byProduct: StandProductRow[];
  byDay: StandDayRow[];
}

/** Totals over the given days (any order). */
export function summarizeStand(input: StandDayData[]): StandSummary {
  const days = [...input].sort((a, b) => a.date.localeCompare(b.date));
  const summary: StandSummary = {
    days: days.length,
    manualDays: 0,
    revenue: 0,
    cash: 0,
    card: 0,
    deposit: 0,
    netRevenue: 0,
    itemsSold: 0,
    cost: 0,
    profit: 0,
    profitComplete: true,
    internalItems: 0,
    internalOutsideItems: 0,
    internalValue: 0,
    internalCost: 0,
    profitAfterInternal: 0,
    variance: 0,
    varianceValue: 0,
    byProduct: [],
    byDay: [],
  };
  const products = new Map<string, StandProductRow>();

  for (const day of days) {
    const row: StandDayRow = { date: day.date, manual: Boolean(day.manual), revenue: 0, cash: 0, card: 0, deposit: 0, profit: 0, internalValue: 0, itemsSold: 0, internalItems: 0, internalOutsideItems: 0 };
    let dayProfitKnown = true;
    let dayCost = 0;
    if (day.manual) {
      summary.manualDays += 1;
      row.cash = day.manual.cashHuf;
      row.card = day.manual.cardHuf;
      row.revenue = day.manual.cashHuf + day.manual.cardHuf;
    }
    for (const line of day.lines) {
      const t = lineTotals(line);
      row.revenue += t.revenue;
      row.cash += t.revenueCash;
      row.card += t.revenueCard;
      row.deposit += t.deposit;
      row.internalValue += t.internalValue;
      row.itemsSold += t.sold;
      row.internalItems += t.internal;
      row.internalOutsideItems += t.internalOutside;
      dayCost += t.cost ?? 0;
      if (t.sold > 0 && t.profit === null) {
        dayProfitKnown = false;
        summary.profitComplete = false;
      }
      summary.cost += t.cost ?? 0;
      summary.profit += t.profit ?? 0;
      summary.internalCost += t.internalCost ?? 0;
      summary.variance += t.variance;
      summary.varianceValue += t.varianceValue;

      const existing = products.get(line.productId);
      if (!existing) {
        products.set(line.productId, {
          productId: line.productId,
          name: line.name,
          category: line.category,
          opening: line.opening,
          restocked: line.restocked,
          sold: t.sold,
          soldCash: line.soldCash,
          soldCard: line.soldCard,
          internal: t.internal,
          internalOutside: line.internalOutside,
          closing: closingOf(line),
          revenue: t.revenue,
          deposit: t.deposit,
          cost: t.cost,
          profit: t.profit,
          internalValue: t.internalValue,
          variance: t.variance,
        });
      } else {
        existing.name = line.name;
        existing.restocked += line.restocked;
        existing.sold += t.sold;
        existing.soldCash += line.soldCash;
        existing.soldCard += line.soldCard;
        existing.internal += t.internal;
        existing.internalOutside += line.internalOutside;
        existing.closing = closingOf(line);
        existing.revenue += t.revenue;
        existing.deposit += t.deposit;
        existing.cost = existing.cost === null && t.cost === null ? null : (existing.cost ?? 0) + (t.cost ?? 0);
        existing.profit = existing.profit === null && t.profit === null ? null : (existing.profit ?? 0) + (t.profit ?? 0);
        existing.internalValue += t.internalValue;
        existing.variance += t.variance;
      }
    }
    // A manual day has no item sales, so no profit to speak of.
    row.profit = day.manual || !dayProfitKnown ? null : row.revenue - row.deposit - dayCost;
    summary.revenue += row.revenue;
    summary.cash += row.cash;
    summary.card += row.card;
    summary.deposit += row.deposit;
    summary.itemsSold += row.itemsSold;
    summary.internalItems += row.internalItems;
    summary.internalOutsideItems += row.internalOutsideItems;
    summary.internalValue += row.internalValue;
    summary.byDay.push(row);
  }

  summary.netRevenue = summary.revenue - summary.deposit;
  summary.profitAfterInternal = summary.profit - summary.internalCost;
  summary.byProduct = [...products.values()].sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name));
  return summary;
}
