import { describe, expect, it } from "vitest";
import type { DayPassConfig } from "@tbook/schemas";
import {
  calculateDayPassQuote,
  dayAvailability,
  eventDayKeys,
  expandDayTickets,
  isWeekendDay,
  parseDayTickets,
  resolveDayPassDiscountCode,
  todayDayKey,
  validateDayTickets,
} from "./day-pass";

const config: DayPassConfig = {
  weekdayPriceHuf: 5000,
  weekendPriceHuf: 8000,
  weekendDays: [6, 0],
  dailyCapacity: 10,
  capacityOverrides: { "2026-07-05": 3 },
  closedDays: ["2026-07-06"],
  weekdaySchedule: null,
  weekendSchedule: null,
  discountCodes: [
    { code: "10", label: "10% kedvezmény", percentOff: 10, enabled: true },
    { code: "DISABLED", label: "Disabled code", percentOff: 50, enabled: false },
  ],
};
const start = new Date("2026-07-03T00:00:00Z"); // Friday
const end = new Date("2026-07-07T00:00:00Z"); // Tuesday

describe("day-pass", () => {
  it("lists every day inclusive and tells weekends apart", () => {
    expect(eventDayKeys(start, end)).toEqual(["2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07"]);
    expect(isWeekendDay("2026-07-04", config.weekendDays)).toBe(true); // Sat
    expect(isWeekendDay("2026-07-03", config.weekendDays)).toBe(false); // Fri
  });

  it("prices weekday and weekend passes, VAT-grossing a net basis", () => {
    const q = calculateDayPassQuote({ config, tickets: { "2026-07-03": 2, "2026-07-04": 1 }, priceBasis: "gross", vatPercent: 27 });
    expect(q.guests).toBe(3);
    expect(q.totalHuf).toBe(2 * 5000 + 8000);
    expect(q.lines.map((l) => l.key)).toEqual(["ticket:2026-07-03", "ticket:2026-07-04"]);

    const net = calculateDayPassQuote({ config, tickets: { "2026-07-03": 1 }, priceBasis: "net", vatPercent: 27 });
    expect(net.totalHuf).toBe(6350);
  });

  it("uses a per-day capacity override and reports remaining", () => {
    const rows = dayAvailability({ config, startDate: start, endDate: end, daySold: { "2026-07-05": 2, "2026-07-03": 10 } });
    const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
    expect(byDate["2026-07-05"]).toMatchObject({ capacity: 3, remaining: 1 });
    expect(byDate["2026-07-03"]).toMatchObject({ capacity: 10, remaining: 0 });
    expect(byDate["2026-07-06"]!.closed).toBe(true);
  });

  it("rejects closed, past, out-of-range and over-capacity days", () => {
    const issues = validateDayTickets({
      config,
      startDate: start,
      endDate: end,
      daySold: { "2026-07-05": 2 },
      today: "2026-07-04",
      tickets: { "2026-07-03": 1, "2026-07-05": 2, "2026-07-06": 1, "2026-08-01": 1 },
    });
    expect(issues.map((i) => i.date).sort()).toEqual(["2026-07-03", "2026-07-05", "2026-07-06", "2026-08-01"]);
  });

  it("lets a console user override past days and capacity", () => {
    const issues = validateDayTickets({
      config,
      startDate: start,
      endDate: end,
      daySold: { "2026-07-05": 3 },
      today: "2026-07-10",
      allowPastDays: true,
      allowOverCapacity: true,
      tickets: { "2026-07-05": 5 },
    });
    expect(issues).toEqual([]);
  });

  it("parses a basket strictly", () => {
    expect(parseDayTickets({ dayPasses: { "2026-07-03": 2, "2026-07-04": 0 } })).toEqual({ tickets: { "2026-07-03": 2 }, errors: [] });
    expect(parseDayTickets({}).errors).toHaveLength(1);
    expect(parseDayTickets({ dayPasses: { "2026-07-03": 1.5 } }).errors).toHaveLength(1);
    expect(parseDayTickets({ dayPasses: { tomorrow: 1 } }).errors).toHaveLength(1);
    expect(parseDayTickets({ dayPasses: [1] }).errors).toHaveLength(1);
  });

  it("expands the basket to one date per ticket, sorted", () => {
    expect(expandDayTickets({ "2026-07-04": 1, "2026-07-03": 2 })).toEqual(["2026-07-03", "2026-07-03", "2026-07-04"]);
  });

  it("reads 'today' in the venue's time zone", () => {
    // 22:30 UTC on the 3rd is already the 4th in Budapest (UTC+2 in summer).
    expect(todayDayKey(new Date("2026-07-03T22:30:00Z"), "Europe/Budapest")).toBe("2026-07-04");
    expect(todayDayKey(new Date("2026-07-03T22:30:00Z"), "UTC")).toBe("2026-07-03");
  });

  it("resolves a discount code case-insensitively and trims it, ignoring disabled or unknown codes", () => {
    expect(resolveDayPassDiscountCode(config, " 10 ")).toMatchObject({ code: "10", percentOff: 10 });
    expect(resolveDayPassDiscountCode(config, "10")).toMatchObject({ percentOff: 10 });
    expect(resolveDayPassDiscountCode(config, "DISABLED")).toBeNull();
    expect(resolveDayPassDiscountCode(config, "NOPE")).toBeNull();
    expect(resolveDayPassDiscountCode(config, null)).toBeNull();
    expect(resolveDayPassDiscountCode(config, "")).toBeNull();
  });

  it("applies a discount code's percent-off to every day's price in the quote", () => {
    const discount = resolveDayPassDiscountCode(config, "10")!;
    const q = calculateDayPassQuote({ config, tickets: { "2026-07-03": 1, "2026-07-04": 1 }, priceBasis: "gross", vatPercent: 27, discount });
    // Weekday 5000 -10% = 4500, weekend 8000 -10% = 7200.
    expect(q.totalHuf).toBe(4500 + 7200);
    expect(q.lines.every((l) => l.label.includes("−10%"))).toBe(true);
  });
});
