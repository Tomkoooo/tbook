import { describe, expect, it } from "vitest";
import { EVENT_TOOL_SLUGS, eventPath, eventPathWith, groupPath, routeContext, switchEventInPath } from "./event-routes";

const E = "64b7f0a1c2d3e4f5a6b7c8d9";
const E2 = "0123456789abcdef01234567";
const G = "aaaaaaaaaaaaaaaaaaaaaaaa";

describe("eventPath / groupPath", () => {
  it("builds the overview, a tool and a tool detail", () => {
    expect(eventPath(E)).toBe(`/admin/events/${E}`);
    expect(eventPath(E, "bus")).toBe(`/admin/events/${E}/bus`);
    expect(eventPath(E, "bus", "route1")).toBe(`/admin/events/${E}/bus/route1`);
    expect(eventPath(E, "bookings", "new")).toBe(`/admin/events/${E}/bookings/new`);
    expect(groupPath(G)).toBe(`/admin/groups/${G}`);
    expect(groupPath(G, "hotels", "h1")).toBe(`/admin/groups/${G}/hotels/h1`);
  });

  it("puts filters in the query, skipping empty ones, and never adds eventId", () => {
    expect(eventPathWith(E, "bookings", { status: "paid", from: undefined, q: "" })).toBe(`/admin/events/${E}/bookings?status=paid`);
    expect(eventPathWith(E, "reports", {})).toBe(`/admin/events/${E}/reports`);
    expect(eventPathWith(E, "bus", { view: "board" }, "export")).toBe(`/admin/events/${E}/bus/export?view=board`);
  });
});

describe("routeContext", () => {
  it("recognises an event, its tool and details", () => {
    expect(routeContext(`/admin/events/${E}`)).toEqual({ kind: "event", eventId: E, tool: null });
    expect(routeContext(`/admin/events/${E}/`)).toEqual({ kind: "event", eventId: E, tool: null });
    expect(routeContext(`/admin/events/${E}/bus`)).toEqual({ kind: "event", eventId: E, tool: "bus" });
    expect(routeContext(`/admin/events/${E}/bus/r1/export`)).toEqual({ kind: "event", eventId: E, tool: "bus" });
    expect(routeContext(`/admin/events/${E}/bookings?status=paid`)).toEqual({ kind: "event", eventId: E, tool: "bookings" });
  });

  it("knows every event tool slug and treats an unknown segment as no tool", () => {
    for (const slug of EVENT_TOOL_SLUGS) expect(routeContext(`/admin/events/${E}/${slug}`)).toMatchObject({ tool: slug });
    expect(routeContext(`/admin/events/${E}/nonsense`)).toEqual({ kind: "event", eventId: E, tool: null });
  });

  it("recognises a group and its tool", () => {
    expect(routeContext(`/admin/groups/${G}`)).toEqual({ kind: "group", groupId: G, tool: null });
    expect(routeContext(`/admin/groups/${G}/hotels/h1`)).toEqual({ kind: "group", groupId: G, tool: "hotels" });
    expect(routeContext(`/admin/groups/${G}/events`)).toEqual({ kind: "group", groupId: G, tool: null });
  });

  it("is org context everywhere else, including the create pages and ids of the wrong shape", () => {
    for (const path of ["/admin", "/admin/events", "/admin/events/new", "/admin/groups/new", "/admin/bookings", `/admin/bookings/${E}`, "/admin/settings/payments", `/admin/events/${E}x`, "/admin/events/short"]) {
      expect(routeContext(path)).toEqual({ kind: "org" });
    }
  });
});

describe("switchEventInPath", () => {
  it("keeps the tool but drops details and query", () => {
    expect(switchEventInPath(`/admin/events/${E}/bus`, E2)).toBe(`/admin/events/${E2}/bus`);
    expect(switchEventInPath(`/admin/events/${E}/bus/route1`, E2)).toBe(`/admin/events/${E2}/bus`);
    expect(switchEventInPath(`/admin/events/${E}/check-in`, E2)).toBe(`/admin/events/${E2}/check-in`);
  });

  it("goes to the overview from the overview, an unknown segment, or outside an event", () => {
    expect(switchEventInPath(`/admin/events/${E}`, E2)).toBe(`/admin/events/${E2}`);
    expect(switchEventInPath(`/admin/events/${E}/nonsense`, E2)).toBe(`/admin/events/${E2}`);
    expect(switchEventInPath("/admin/bookings", E2)).toBe(`/admin/events/${E2}`);
  });
});
