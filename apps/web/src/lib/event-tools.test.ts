import { describe, expect, it } from "vitest";
import { EVENT_TOOLS, GROUP_TOOLS, GROUP_TOOL_KEYS, categorizeModules, eventToolLinks, filterEventTools, filterGroupTools, groupToolLinks, toolLabelsForModule } from "./event-tools";
import { EVENT_TOOL_SLUGS } from "./event-routes";

const OWNER = ["booking:read", "booking:manage", "voucher:read", "sale:create", "hotel:read", "bus:manage", "waitlist:manage", "feedback:manage", "email:send", "list:manage", "event:read", "event:write"];
const on = (...keys: string[]) => (key: string) => keys.includes(key);
const keysOf = (tools: ReturnType<typeof filterEventTools>) => tools.map((tool) => tool.key);

describe("EVENT_TOOLS registry", () => {
  it("has exactly one tool per event route slug, in a stable order", () => {
    expect(EVENT_TOOLS.map((tool) => tool.slug).sort()).toEqual([...EVENT_TOOL_SLUGS].sort());
    expect(EVENT_TOOLS.map((tool) => tool.key)).toEqual(["bookings", "check-in", "sales", "stand", "vip", "bus", "waitlist", "feedback", "kiosk", "emails", "reports", "preview"]);
  });

  it("no longer carries hotels (a group tool) or data lists (an org tool)", () => {
    const keys = EVENT_TOOLS.map((tool) => tool.key);
    expect(keys).not.toContain("hotels");
    expect(keys).not.toContain("data");
  });

  it("links every tool to its path-based route, never a ?eventId= query", () => {
    const ctx = { eventId: "e1", groupId: "g1" };
    for (const tool of EVENT_TOOLS) {
      expect(tool.href(ctx)).toBe(`/admin/events/e1/${tool.slug}`);
      expect(tool.href(ctx)).not.toContain("?");
    }
  });
});

describe("filterEventTools", () => {
  it("offers only the always-on tools when no module is on for the event", () => {
    expect(keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on() }))).toEqual(["reports", "preview"]);
  });

  it("adds a tool exactly when its module is on for that event", () => {
    const keys = keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on("bus-transport", "ticket-sales") }));
    expect(keys).toEqual(expect.arrayContaining(["bus", "bookings", "check-in"]));
    expect(keys).not.toContain("waitlist");
    expect(keys).not.toContain("emails");
    expect(keys).not.toContain("sales");
    expect(keys).not.toContain("stand");
  });

  it("feedback switches on both the surveys and the kiosk", () => {
    expect(keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on("feedback") }))).toEqual(expect.arrayContaining(["feedback", "kiosk"]));
  });

  it("offers the counter and the stand with their modules", () => {
    expect(keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on("point-of-sale", "stand-mode") }))).toEqual(expect.arrayContaining(["sales", "stand"]));
  });

  it("hides a tool the member has no permission for, even with the module on", () => {
    const keys = keysOf(filterEventTools(EVENT_TOOLS, { permissions: ["event:read"], isOn: on("bus-transport", "ticket-sales", "event-emails") }));
    expect(keys).toEqual(["preview"]);
  });

  it("honours permission fallbacks (feedback:kiosk falls back to event:write)", () => {
    expect(keysOf(filterEventTools(EVENT_TOOLS, { permissions: ["event:write"], isOn: on("feedback") }))).toContain("kiosk");
  });

  it("shows VIP guests only when the event has a VIP list", () => {
    expect(keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on() }))).not.toContain("vip");
    expect(keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on(), hasVipList: true }))).toContain("vip");
  });
});

describe("tool links", () => {
  it("turns tools into plain link data with short tab labels", () => {
    const tools = filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on("ticket-sales", "bus-transport") });
    const links = eventToolLinks(tools, { eventId: "e1", groupId: null });
    expect(links.find((link) => link.key === "bookings")).toEqual({ key: "bookings", label: "Guests", href: "/admin/events/e1/bookings", icon: "bookings" });
    expect(links.find((link) => link.key === "bus")?.href).toBe("/admin/events/e1/bus");
    expect(JSON.parse(JSON.stringify(links))).toEqual(links);
  });
});

describe("group tools", () => {
  it("hotels is the one group tool, shown with the hotels module and hotel:read", () => {
    expect(GROUP_TOOL_KEYS).toEqual(["hotels"]);
    expect(filterGroupTools(GROUP_TOOLS, { permissions: OWNER, isOn: on("hotels") }).map((tool) => tool.key)).toEqual(["hotels"]);
    expect(filterGroupTools(GROUP_TOOLS, { permissions: OWNER, isOn: on() })).toEqual([]);
    expect(filterGroupTools(GROUP_TOOLS, { permissions: ["event:read"], isOn: on("hotels") })).toEqual([]);
  });

  it("links to the group's path-based hotels route", () => {
    expect(groupToolLinks(GROUP_TOOLS, "g1")).toEqual([{ key: "hotels", label: "Hotels", href: "/admin/groups/g1/hotels", icon: "hotels" }]);
  });
});

describe("module switches", () => {
  it("groups the switches into categories and drops empty ones", () => {
    const rows = [{ key: "waitlist" }, { key: "hotels" }, { key: "event-emails" }, { key: "something-new" }];
    expect(categorizeModules(rows).map((category) => [category.label, category.rows.map((row) => row.key)])).toEqual([
      ["Selling", ["waitlist"]],
      ["Guests & travel", ["hotels"]],
      ["Communication", ["event-emails"]],
      ["Other", ["something-new"]],
    ]);
  });

  it("names the tools a module adds (event and group tools)", () => {
    expect(toolLabelsForModule("feedback")).toEqual(["Feedback", "Kiosk"]);
    expect(toolLabelsForModule("hotels")).toEqual(["Hotels"]);
    expect(toolLabelsForModule("free-registration")).toEqual([]);
  });
});
