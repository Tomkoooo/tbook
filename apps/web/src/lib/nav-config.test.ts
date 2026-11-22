import { describe, expect, it } from "vitest";
import { NAV_GROUPS, filterNavGroups, hasAnyPermission, isNavItemActive, isNavItemVisible } from "./nav-config";

const OWNER = ["group:read", "event:read", "sale:create", "booking:read", "booking:manage", "voucher:read", "product:read", "member:read", "org:update"];
const ALL_MODULES = ["point-of-sale", "stand-mode", "ticket-sales", "hotels", "bus-transport", "waitlist"];

const hrefs = (groups: ReturnType<typeof filterNavGroups>) => groups.flatMap((group) => group.items.map((item) => item.href));

describe("filterNavGroups", () => {
  it("keeps the sidebar global: no per-event tools, whatever the member holds", () => {
    const all = hrefs(filterNavGroups(NAV_GROUPS, { permissions: OWNER, modules: ALL_MODULES }));
    for (const removed of ["hotels", "bus", "vip", "waitlist", "feedback", "kiosk", "emails", "reports", "data", "preview"]) {
      expect(all).not.toContain(`/admin/${removed}`);
    }
  });

  it("shows the whole sales group when the modules are on and the permissions are held", () => {
    const groups = filterNavGroups(NAV_GROUPS, { permissions: OWNER, modules: ALL_MODULES });
    expect(groups.map((group) => group.label)).toEqual(["Overview", "Events", "Sales", "Catalog", "Organization"]);
    expect(groups.find((group) => group.label === "Sales")?.items.map((item) => item.label)).toEqual(["Point of sale", "Stand", "Ticket bookings", "Check-in"]);
  });

  it("hides a sales page whose module is off for the organization, even for an owner", () => {
    const sales = hrefs(filterNavGroups(NAV_GROUPS, { permissions: OWNER, modules: ["ticket-sales"] }));
    expect(sales).toContain("/admin/bookings");
    expect(sales).toContain("/admin/check-in");
    expect(sales).not.toContain("/admin/sales");
    expect(sales).not.toContain("/admin/stand");
  });

  it("hides a sales page whose permission is missing, even with the module on", () => {
    const paths = hrefs(filterNavGroups(NAV_GROUPS, { permissions: ["booking:read"], modules: ALL_MODULES }));
    expect(paths).toContain("/admin/bookings");
    expect(paths).not.toContain("/admin/check-in"); // needs voucher:read
    expect(paths).not.toContain("/admin/sales");
    expect(paths).not.toContain("/admin/members");
  });

  it("drops the Sales group entirely for a new organization with no modules", () => {
    const groups = filterNavGroups(NAV_GROUPS, { permissions: OWNER, modules: [] });
    expect(groups.map((group) => group.label)).not.toContain("Sales");
    expect(hrefs(groups)).toEqual(expect.arrayContaining(["/admin", "/admin/help", "/admin/events", "/admin/groups", "/admin/products", "/admin/members", "/admin/settings"]));
  });

  it("always shows the pages with no permission (Dashboard, Help), even with nothing granted", () => {
    expect(hrefs(filterNavGroups(NAV_GROUPS, { permissions: [], modules: [] }))).toEqual(["/admin", "/admin/help"]);
  });

  it("honours permission fallbacks for roles saved before a permission existed", () => {
    // stand:operate falls back to sale:create / event:write, already listed; email:send falls back to booking:manage.
    expect(hasAnyPermission(new Set(["booking:manage"]), "email:send")).toBe(true);
    expect(hasAnyPermission(new Set(["booking:read"]), "email:send")).toBe(false);
  });
});

describe("isNavItemVisible / isNavItemActive", () => {
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
});
