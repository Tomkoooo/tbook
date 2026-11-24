import { describe, expect, it } from "vitest";
import { busBookingClosed, busBookingClosedAt } from "./index";

const start = new Date("2026-12-04T16:00:00Z");

describe("bus booking deadline", () => {
  it("is never closed without a readable deadline", () => {
    expect(busBookingClosedAt(undefined, start)).toBe(false);
    expect(busBookingClosedAt("soon", start)).toBe(false);
  });
  it("closes at the Budapest wall-clock time", () => {
    expect(busBookingClosedAt("2026-11-24 16:00", start, Date.parse("2026-11-24T14:59:59Z"))).toBe(false);
    expect(busBookingClosedAt("2026-11-24 16:00", start, Date.parse("2026-11-24T15:00:00Z"))).toBe(true);
  });
  it("ignores the setting when guest-portal is off", () => {
    const off = { isOn: () => false, config: () => ({ busChangesCloseAt: "2000-01-01 00:00" }) };
    expect(busBookingClosed(off, start)).toBe(false);
  });
});
