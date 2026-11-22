import { describe, expect, it } from "vitest";
import { NAV_GROUPS } from "./nav-config";
import { buildEventShortcuts, buildOrgLinks, eventDateLabel, needsOrgChoice, pickHomeEvents, soleOrganizationToSelect, type HomeEventInput } from "./home-data";

const event = (id: string, start: string, end: string, status = "active", name = id): HomeEventInput => ({
  id,
  name,
  status,
  startDate: new Date(`${start}T00:00:00Z`),
  endDate: new Date(`${end}T00:00:00Z`),
  groupId: null,
});
// Midday in Budapest, 2026-11-22.
const NOW = new Date("2026-11-22T12:00:00Z");

describe("pickHomeEvents", () => {
  it("returns the active events that are on today, including multi-day ones", () => {
    const picked = pickHomeEvents(
      [event("past", "2026-11-01", "2026-11-02"), event("multi", "2026-11-21", "2026-11-23"), event("one", "2026-11-22", "2026-11-22"), event("later", "2026-12-01", "2026-12-01")],
      NOW,
    );
    expect(picked.mode).toBe("today");
    expect(picked.events.map((e) => e.id)).toEqual(["multi", "one"]);
  });

  it("ignores drafts and archived events", () => {
    const picked = pickHomeEvents([event("d", "2026-11-22", "2026-11-22", "draft"), event("a", "2026-11-22", "2026-11-22", "archived")], NOW);
    expect(picked).toEqual({ mode: "none", events: [] });
  });

  it("uses the Budapest day: just after midnight local time is already the next day", () => {
    const lateNight = new Date("2026-11-21T23:30:00Z"); // 00:30 on the 22nd in Budapest
    expect(pickHomeEvents([event("e", "2026-11-22", "2026-11-22")], lateNight).mode).toBe("today");
    expect(pickHomeEvents([event("e", "2026-11-21", "2026-11-21")], lateNight).mode).toBe("none");
  });

  it("falls back to the next three upcoming events, soonest first", () => {
    const picked = pickHomeEvents(
      [event("d", "2026-12-04", "2026-12-04"), event("a", "2026-11-25", "2026-11-25"), event("c", "2026-12-01", "2026-12-01"), event("b", "2026-11-30", "2026-11-30"), event("old", "2026-10-01", "2026-10-01")],
      NOW,
    );
    expect(picked.mode).toBe("upcoming");
    expect(picked.events.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("reports none when there is nothing today or later", () => {
    expect(pickHomeEvents([], NOW)).toEqual({ mode: "none", events: [] });
    expect(pickHomeEvents([event("old", "2026-10-01", "2026-10-02")], NOW).mode).toBe("none");
  });
});

const on = (...keys: string[]) => (key: string) => keys.includes(key);
const ctx = { eventId: "e1", groupId: null };
const keys = (shortcuts: ReturnType<typeof buildEventShortcuts>) => shortcuts.map((s) => s.key);

describe("buildEventShortcuts", () => {
  const ALL_ON = on("ticket-sales", "point-of-sale", "stand-mode", "bus-transport", "feedback", "waitlist");

  it("gives a door member only check-in", () => {
    expect(keys(buildEventShortcuts({ permissions: ["event:read", "booking:read", "voucher:read", "voucher:scan"], isOn: ALL_ON }, ctx))).toEqual(["check-in", "bookings"]);
  });

  it("gives a cashier the counter, the stand (via sale:create) and guest lookup", () => {
    const cashier = ["event:read", "product:read", "sale:create", "booking:read", "voucher:read"];
    expect(keys(buildEventShortcuts({ permissions: cashier, isOn: ALL_ON }, ctx))).toEqual(["check-in", "sales", "stand", "bookings"]);
  });

  it("gives a bus captain only the bus, a stand seller only the stand, a kiosk operator only the kiosk", () => {
    expect(keys(buildEventShortcuts({ permissions: ["event:read", "bus:board"], isOn: ALL_ON }, ctx))).toEqual(["bus"]);
    expect(keys(buildEventShortcuts({ permissions: ["event:read", "stand:operate"], isOn: ALL_ON }, ctx))).toEqual(["stand"]);
    expect(keys(buildEventShortcuts({ permissions: ["event:read", "feedback:kiosk"], isOn: ALL_ON }, ctx))).toEqual(["kiosk"]);
  });

  it("honours permission fallbacks for roles saved before a permission existed", () => {
    expect(keys(buildEventShortcuts({ permissions: ["booking:manage"], isOn: ALL_ON }, ctx))).toEqual(["sales", "bus", "waitlist"]);
  });

  it("drops a tool whose module is off for that event", () => {
    expect(keys(buildEventShortcuts({ permissions: ["sale:create", "voucher:read"], isOn: on("point-of-sale") }, ctx))).toEqual(["sales"]);
  });

  it("never offers non-operational tools (reports, preview, hotels…) and links to the event", () => {
    const shortcuts = buildEventShortcuts({ permissions: ["event:read", "event:write", "booking:read", "booking:manage", "voucher:read", "hotel:read"], isOn: on("hotels", "ticket-sales", "point-of-sale") }, ctx);
    expect(keys(shortcuts)).not.toContain("reports");
    expect(keys(shortcuts)).not.toContain("hotels");
    expect(keys(shortcuts)).not.toContain("preview");
    for (const shortcut of shortcuts) expect(shortcut.href).toContain("/admin/");
  });

  it("returns nothing for a member with no operational permission", () => {
    expect(buildEventShortcuts({ permissions: ["event:read"], isOn: ALL_ON }, ctx)).toEqual([]);
  });
});

describe("buildOrgLinks", () => {
  it("lists what the member can open, without the dashboard", () => {
    const links = buildOrgLinks(NAV_GROUPS, { permissions: ["event:read", "member:read"], modules: [] });
    expect(links.map((l) => l.href)).toEqual(["/admin/help", "/admin/events", "/admin/products", "/admin/members"]);
  });
});

describe("eventDateLabel", () => {
  it("formats a single day and a range", () => {
    expect(eventDateLabel(new Date("2026-11-22T00:00:00Z"), new Date("2026-11-22T00:00:00Z"))).toBe("22 Nov 2026");
    expect(eventDateLabel(new Date("2026-11-21T00:00:00Z"), new Date("2026-11-23T00:00:00Z"))).toBe("21 Nov – 23 Nov 2026");
  });
});

describe("org selection helpers", () => {
  it("shows the picker only for several orgs with no usable active org", () => {
    expect(needsOrgChoice({ organizationCount: 2, hasValidActiveOrg: false, isSystemAdmin: false })).toBe(true);
    expect(needsOrgChoice({ organizationCount: 2, hasValidActiveOrg: true, isSystemAdmin: false })).toBe(false);
    expect(needsOrgChoice({ organizationCount: 1, hasValidActiveOrg: false, isSystemAdmin: false })).toBe(false);
    expect(needsOrgChoice({ organizationCount: 5, hasValidActiveOrg: false, isSystemAdmin: true })).toBe(false);
  });

  it("selects the sole organization only when none is active", () => {
    const orgs = [{ id: "o1" }];
    expect(soleOrganizationToSelect({ organizations: orgs, hasValidActiveOrg: false, isSystemAdmin: false })).toEqual({ id: "o1" });
    expect(soleOrganizationToSelect({ organizations: orgs, hasValidActiveOrg: true, isSystemAdmin: false })).toBeNull();
    expect(soleOrganizationToSelect({ organizations: [{ id: "a" }, { id: "b" }], hasValidActiveOrg: false, isSystemAdmin: false })).toBeNull();
    expect(soleOrganizationToSelect({ organizations: orgs, hasValidActiveOrg: false, isSystemAdmin: true })).toBeNull();
  });
});
