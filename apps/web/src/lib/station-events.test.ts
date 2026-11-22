import { describe, expect, it } from "vitest";
import { orderTodayFirst } from "./station-events";

const day = (iso: string) => new Date(`${iso}T10:00:00Z`);
const event = (name: string, status: string, start: string, end: string) => ({ name, status, startDate: day(start), endDate: day(end) });

describe("orderTodayFirst", () => {
  const now = day("2026-07-04");

  it("puts active events running today before the others, keeping the given order inside each group", () => {
    const rows = orderTodayFirst(
      [event("past", "active", "2026-06-01", "2026-06-02"), event("today-b", "active", "2026-07-03", "2026-07-05"), event("later", "active", "2026-08-01", "2026-08-02"), event("today-a", "active", "2026-07-04", "2026-07-04")],
      now,
    );
    expect(rows.map((row) => row.event.name)).toEqual(["today-b", "today-a", "past", "later"]);
    expect(rows.map((row) => row.today)).toEqual([true, true, false, false]);
  });

  it("does not treat an inactive event as today's", () => {
    const rows = orderTodayFirst([event("draft", "draft", "2026-07-03", "2026-07-05"), event("live", "active", "2026-07-04", "2026-07-04")], now);
    expect(rows.map((row) => row.event.name)).toEqual(["live", "draft"]);
    expect(rows[1]!.today).toBe(false);
  });

  it("returns an empty list for no events", () => {
    expect(orderTodayFirst([], now)).toEqual([]);
  });
});
