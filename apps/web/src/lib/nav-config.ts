import type { Permission } from "@tbook/schemas";
import { permissionWithFallbacks } from "./permission-fallbacks";

/**
 * The console's global navigation as data, plus the pure filtering that
 * decides what one member sees. Kept free of React so it can be unit
 * tested; the sidebar and the command palette both render from it.
 *
 * Only global pages live here. Tools that belong to a particular event or
 * event group (hotels, buses, VIP guests, waitlist, feedback, emails,
 * reports, data, preview) are reached from that event's page — see
 * event-tools.ts.
 */

export type NavIconKey =
  | "dashboard"
  | "help"
  | "groups"
  | "events"
  | "pos"
  | "stand"
  | "bookings"
  | "checkin"
  | "products"
  | "team"
  | "settings"
  | "organizations";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
  /** Permission(s) the page requires, any one of which suffices; null = visible to every member. */
  permission: string | readonly string[] | null;
  /** Extra path prefixes that should also mark this link active. */
  alsoActiveOn?: readonly string[];
  /** Shown only when the organization has been granted this module. */
  module?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: "dashboard", permission: null },
      { href: "/admin/help", label: "Help", icon: "help", permission: null },
    ],
  },
  {
    label: "Events",
    items: [
      { href: "/admin/groups", label: "Event groups", icon: "groups", permission: "group:read" },
      { href: "/admin/events", label: "Events", icon: "events", permission: "event:read" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/admin/sales", label: "Point of sale", icon: "pos", permission: ["sale:create", "booking:manage"], module: "point-of-sale" },
      {
        href: "/admin/stand",
        label: "Stand",
        icon: "stand",
        permission: ["stand:operate", "stand:manage", "sale:create", "event:write"],
        module: "stand-mode",
      },
      { href: "/admin/bookings", label: "Ticket bookings", icon: "bookings", permission: "booking:read", module: "ticket-sales" },
      { href: "/admin/check-in", label: "Check-in", icon: "checkin", permission: "voucher:read", module: "ticket-sales" },
    ],
  },
  {
    label: "Catalog",
    items: [{ href: "/admin/products", label: "Products", icon: "products", permission: ["product:read", "product:write", "event:read"] }],
  },
  {
    label: "Organization",
    items: [
      { href: "/admin/members", label: "Team", icon: "team", permission: "member:read" },
      { href: "/admin/settings", label: "Settings", icon: "settings", permission: "org:update", alsoActiveOn: ["/admin/integrations"] },
    ],
  },
];

/** Only shown to platform system admins. */
export const PLATFORM_ITEMS: NavItem[] = [{ href: "/admin/organizations", label: "Organizations", icon: "organizations", permission: null }];

/** Pages reachable from the command palette that the sidebar deliberately doesn't list. */
export const EXTRA_PAGES: NavItem[] = [
  { href: "/admin/integrations", label: "Integrations", icon: "settings", permission: "org:update" },
  { href: "/admin/select-org", label: "Switch organization", icon: "organizations", permission: null },
  { href: "/admin/device-link", label: "Sign in another device (QR)", icon: "settings", permission: null },
];

export interface NavAccess {
  /** The acting member's permissions. */
  permissions: Iterable<string>;
  /** Modules granted to the active organization. */
  modules: Iterable<string>;
}

/** Does the member hold one of `permission` (or a fallback of it)? null/empty = anyone. */
export function hasAnyPermission(granted: ReadonlySet<string>, permission: string | readonly string[] | null | undefined): boolean {
  if (!permission || (Array.isArray(permission) && permission.length === 0)) return true;
  return ([permission].flat() as string[]).some((p) => permissionWithFallbacks(p as Permission).some((candidate) => granted.has(candidate)));
}

/** Is this one item visible: its module is on for the org and the member has the permission. */
export function isNavItemVisible(item: NavItem, access: NavAccess): boolean {
  const modules = new Set(access.modules);
  const granted = new Set(access.permissions);
  return (!item.module || modules.has(item.module)) && hasAnyPermission(granted, item.permission);
}

/** The groups a member sees: items filtered by module + permission, empty groups dropped. */
export function filterNavGroups(groups: readonly NavGroup[], access: NavAccess): NavGroup[] {
  const modules = new Set(access.modules);
  const granted = new Set(access.permissions);
  return groups
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) => (!item.module || modules.has(item.module)) && hasAnyPermission(granted, item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}

/** Whether a nav link is the current page (the dashboard only on an exact match). */
export function isNavItemActive(item: Pick<NavItem, "href" | "alsoActiveOn">, pathname: string): boolean {
  if (item.href === "/admin") return pathname === "/admin";
  return [item.href, ...(item.alsoActiveOn ?? [])].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
