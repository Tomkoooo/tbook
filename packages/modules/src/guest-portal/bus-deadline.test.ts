import { describe, expect, it } from "vitest";
import type { IEvent } from "@tbook/db";
import { busChangesClosed } from "./service";

const event = { startDate: new Date("2026-12-04T16:00:00Z") } as unknown as IEvent;

describe("busChangesClosed", () => {
  it("has no deadline when unset or unreadable", () => {
    expect(busChangesClosed({}, event)).toBe(false);
    expect(busChangesClosed({ busChangesCloseAt: "soon" }, event)).toBe(false);
  });
  it("closes at the Budapest wall-clock time", () => {
    const config = { busChangesCloseAt: "2026-11-24 16:00" };
    expect(busChangesClosed(config, event, Date.parse("2026-11-24T14:59:59Z"))).toBe(false);
    expect(busChangesClosed(config, event, Date.parse("2026-11-24T15:00:00Z"))).toBe(true);
  });
});
