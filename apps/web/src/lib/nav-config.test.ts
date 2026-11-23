import { describe, expect, it } from "vitest";
import { NAV_GROUPS, filterNavGroups, hasAnyPermission, isNavItemActive, isNavItemVisible, isTabActive } from "./nav-config";

const OWNER = ["group:read", "event:read", "event:write", "sale:create", "booking:read", "booking:manage", "voucher:read", "product:read", "member:read", "org:update", "list:manage"];
const ALL_MODULES = ["point-of-sale", "stand-mode", "ticket-sales", "hotels", "bus-transport", "waitlist"];

const hrefs = (groups: ReturnType<typeof filterNavGroups>) => groups.flatMap((group) => group.items.map((item) => item.href));

describe("filterNavGroups", () => {
  it("keeps the sidebar to org pages and stations: no per-event or per-group tools, whatever the member holds", () => {
    const all = hrefs(filterNavGroups(NAV_GROUPS, { permissions: OWNER, modules: ALL_MODULES }));
    for (const removed of ["hotels", "bus", "vip", "waitlist", "feedback", "kiosk", "emails", "preview"]) {
      expect(all).not.toContain(`/admin/${removed}`);
    }
  });

  it("shows every group and item when the modules are on and the permissions are held", () => {
    const groups = filterNavGroups(NAV_GROUPS, { permissions: OWNER, modules: ALL_MODULES });
    expect(groups.map((group) => group.label)).toEqual(["Home", "Events", "Organization", "Stations"]);
    expect(groups.find((group) => group.label === "Organization")?.items.map((item) => item.label)).toEqual(["Bookings", "Reports", "Products", "Merch register", "Data lists", "Team", "Settings"]);
    expect(groups.find((group) => group.label === "Stations")?.items.map((item) => item.label)).toEqual(["Check-in", "Point of sale", "Stand"]);
  });

  it("hides a page whose module is off for the organization, even for an owner", () => {
    const paths = hrefs(filterNavGroups(NAV_GROUPS, { permissions: OWNER, modules: ["ticket-sales"] }));
    expect(paths).toContain("/admin/bookings");
    expect(paths).toContain("/admin/check-in");
    for (const hidden of ["/admin/sales", "/admin/stand", "/admin/merch"]) expect(paths).not.toContain(hidden);
  });

  it("hides a page whose permission is missing, even with the module on", () => {
    const paths = hrefs(filterNavGroups(NAV_GROUPS, { permissions: ["booking:read"], modules: ALL_MODULES }));
    expect(paths).toContain("/admin/bookings");
    expect(paths).not.toContain("/admin/check-in"); // needs voucher:read
    expect(paths).not.toContain("/admin/sales");
    expect(paths).not.toContain("/admin/merch");
    expect(paths).not.toContain("/admin/data");
    expect(paths).not.toContain("/admin/members");
  });

  it("gives door, counter and stand staff who only hold event:read the stations they hold permissions for", () => {
    // A door person: voucher:read + event:read. The counter and stand need sale:create / stand permissions.
    const paths = hrefs(filterNavGroups(NAV_GROUPS, { permissions: ["event:read", "voucher:read"], modules: ALL_MODULES }));
    expect(paths).toEqual(expect.arrayContaining(["/admin/events", "/admin/check-in", "/admin/products"]));
    expect(paths).not.toContain("/admin/sales");
    const counter = hrefs(filterNavGroups(NAV_GROUPS, { permissions: ["event:read", "sale:create"], modules: ALL_MODULES }));
    expect(counter).toEqual(expect.arrayContaining(["/admin/sales", "/admin/stand", "/admin/merch"]));
  });

  it("drops the Stations group for a new organization with no modules", () => {
    const groups = filterNavGroups(NAV_GROUPS, { permissions: OWNER, modules: [] });
    expect(groups.map((group) => group.label)).not.toContain("Stations");
    expect(hrefs(groups)).toEqual(expect.arrayContaining(["/admin", "/admin/help", "/admin/events", "/admin/groups", "/admin/products", "/admin/data", "/admin/members", "/admin/settings"]));
  });

  it("always shows the pages with no permission (Home, Help), even with nothing granted", () => {
    expect(hrefs(filterNavGroups(NAV_GROUPS, { permissions: [], modules: [] }))).toEqual(["/admin", "/admin/help"]);
  });

  it("honours permission fallbacks for roles saved before a permission existed", () => {
    // email:send falls back to booking:manage; list:manage to event:write.
    expect(hasAnyPermission(new Set(["booking:manage"]), "email:send")).toBe(true);
    expect(hasAnyPermission(new Set(["booking:read"]), "email:send")).toBe(false);
    expect(hrefs(filterNavGroups(NAV_GROUPS, { permissions: ["event:write"], modules: [] }))).toContain("/admin/data");
  });

  it("does not mutate the registry", () => {
    const before = JSON.stringify(NAV_GROUPS);
    filterNavGroups(NAV_GROUPS, { permissions: [], modules: [] });
    expect(JSON.stringify(NAV_GROUPS)).toBe(before);
  });
});

describe("isNavItemVisible / isNavItemActive / isTabActive", () => {
  const pos = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.href === "/admin/sales")!;

  it("checks a single item the same way", () => {
    expect(isNavItemVisible(pos, { permissions: ["sale:create"], modules: ["point-of-sale"] })).toBe(true);
    expect(isNavItemVisible(pos, { permissions: ["sale:create"], modules: [] })).toBe(false);
    expect(isNavItemVisible(pos, { permissions: [], modules: ["point-of-sale"] })).toBe(false);
  });

  it("marks the dashboard only on an exact match and others by path prefix", () => {
    expect(isNavItemActive({ href: "/admin" }, "/admin")).toBe(true);
    expect(isNavItemActive({ href: "/admin" }, "/admin/events")).toBe(false);
    expect(isNavItemActive({ href: "/admin/events" }, "/admin/events/abc")).toBe(true);
    expect(isNavItemActive({ href: "/admin/events" }, "/admin/events-archive")).toBe(false);
    expect(isNavItemActive({ href: "/admin/settings", alsoActiveOn: ["/admin/integrations"] }, "/admin/integrations")).toBe(true);
  });

  it("marks a workspace tab by prefix, and the overview tab only on its own path", () => {
    const overview = { href: "/admin/events/e1", exact: true };
    const bus = { href: "/admin/events/e1/bus" };
    expect(isTabActive(overview, "/admin/events/e1")).toBe(true);
    expect(isTabActive(overview, "/admin/events/e1/")).toBe(true);
    expect(isTabActive(overview, "/admin/events/e1/bus")).toBe(false);
    expect(isTabActive(bus, "/admin/events/e1/bus")).toBe(true);
    expect(isTabActive(bus, "/admin/events/e1/bus/r1")).toBe(true);
    expect(isTabActive(bus, "/admin/events/e1/bus-x")).toBe(false);
    expect(isTabActive({ href: "/admin/events/e1/bookings?x=1" }, "/admin/events/e1/bookings")).toBe(true);
  });
});
