import { describe, expect, it } from "vitest";
import { EVENT_TOOLS, GROUP_TOOL_KEYS, categorizeModules, filterEventTools, toolLabelsForModule } from "./event-tools";

const OWNER = ["booking:read", "booking:manage", "voucher:read", "sale:create", "hotel:read", "bus:manage", "waitlist:manage", "feedback:manage", "email:send", "list:manage", "event:read", "event:write"];
const on = (...keys: string[]) => (key: string) => keys.includes(key);
const keysOf = (tools: ReturnType<typeof filterEventTools>) => tools.map((tool) => tool.key);

describe("filterEventTools", () => {
  it("offers only the always-on tools when no module is on for the event", () => {
    expect(keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on() }))).toEqual(["reports", "data", "preview"]);
  });

  it("adds a tool exactly when its module is on for that event", () => {
    const keys = keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on("bus-transport", "hotels", "ticket-sales") }));
    expect(keys).toEqual(expect.arrayContaining(["bus", "hotels", "bookings", "check-in"]));
    expect(keys).not.toContain("waitlist");
    expect(keys).not.toContain("emails");
    expect(keys).not.toContain("sales");
  });

  it("feedback switches on both the surveys and the kiosk", () => {
    expect(keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on("feedback") }))).toEqual(expect.arrayContaining(["feedback", "kiosk"]));
  });

  it("hides a tool the member has no permission for, even with the module on", () => {
    const keys = keysOf(filterEventTools(EVENT_TOOLS, { permissions: ["event:read"], isOn: on("bus-transport", "hotels", "ticket-sales", "event-emails") }));
    expect(keys).toEqual(["preview"]);
  });

  it("shows VIP guests only when the event has a VIP list", () => {
    expect(keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on() }))).not.toContain("vip");
    expect(keysOf(filterEventTools(EVENT_TOOLS, { permissions: OWNER, isOn: on(), hasVipList: true }))).toContain("vip");
  });

  it("links to the existing pages with the event preselected", () => {
    const ctx = { eventId: "e1", groupId: "g1" };
    const href = (key: string) => EVENT_TOOLS.find((tool) => tool.key === key)!.href(ctx);
    expect(href("bus")).toBe("/admin/bus?eventId=e1");
    expect(href("waitlist")).toBe("/admin/waitlist?eventId=e1");
    expect(href("emails")).toBe("/admin/emails?eventId=e1");
    expect(href("reports")).toBe("/admin/reports?eventId=e1");
    expect(href("preview")).toBe("/admin/preview?eventId=e1");
    expect(href("bookings")).toBe("/admin/bookings?eventId=e1");
    expect(href("check-in")).toBe("/admin/check-in/e1");
    expect(href("hotels")).toBe("/admin/hotels?groupId=g1");
    expect(EVENT_TOOLS.find((tool) => tool.key === "hotels")!.href({ eventId: "e1", groupId: null })).toBe("/admin/hotels");
  });

  it("group tools are a subset of the tools", () => {
    for (const key of GROUP_TOOL_KEYS) expect(EVENT_TOOLS.some((tool) => tool.key === key)).toBe(true);
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

  it("names the tools a module adds", () => {
    expect(toolLabelsForModule("feedback")).toEqual(["Feedback", "Kiosk"]);
    expect(toolLabelsForModule("free-registration")).toEqual([]);
  });
});
