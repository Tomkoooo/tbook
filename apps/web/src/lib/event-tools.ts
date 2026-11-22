import { eventPath, groupPath, type EventToolSlug, type GroupToolSlug } from "./event-routes";
import { hasAnyPermission } from "./nav-config";

/**
 * The per-event tools: pages that hang off an event (or event group) and live
 * under /admin/events/[eventId]/<slug> (or /admin/groups/[groupId]/<slug>).
 * Each tool names the module that must be on for that event and the
 * permission the page needs. One registry feeds the event tabs, the sidebar's
 * contextual section, the command palette and the home page. Pure data plus
 * filters so it can be unit tested.
 */

export type EventToolIconKey =
  | "bookings"
  | "checkin"
  | "pos"
  | "stand"
  | "vip"
  | "hotels"
  | "bus"
  | "waitlist"
  | "feedback"
  | "kiosk"
  | "emails"
  | "reports"
  | "preview";

export interface EventToolContext {
  eventId: string;
  groupId: string | null;
}

export interface EventTool {
  key: string;
  /** The route segment under /admin/events/[eventId]/. */
  slug: EventToolSlug;
  label: string;
  /** Shorter name for tabs and the sidebar; defaults to `label`. */
  shortLabel?: string;
  description: string;
  icon: EventToolIconKey;
  /** Module that must be on for the event; none = always offered. */
  module?: string;
  /** Permission(s) the page needs, any one suffices. */
  permission: string | readonly string[];
  /** Only offered when the event has a VIP name list. */
  needsVipList?: boolean;
  href: (ctx: EventToolContext) => string;
}

/** Every tool that lives under an event, in tab order. */
export const EVENT_TOOLS: readonly EventTool[] = [
  {
    key: "bookings",
    slug: "bookings",
    label: "Guests & bookings",
    shortLabel: "Guests",
    description: "Everyone registered or booked, with details and vouchers.",
    icon: "bookings",
    module: "ticket-sales",
    permission: "booking:read",
    href: ({ eventId }) => eventPath(eventId, "bookings"),
  },
  {
    key: "check-in",
    slug: "check-in",
    label: "Check-in",
    description: "Scan tickets at the door and see who has arrived.",
    icon: "checkin",
    module: "ticket-sales",
    permission: "voucher:read",
    href: ({ eventId }) => eventPath(eventId, "check-in"),
  },
  {
    key: "sales",
    slug: "sales",
    label: "Point of sale",
    description: "Sell tickets at the counter.",
    icon: "pos",
    module: "point-of-sale",
    permission: ["sale:create", "booking:manage"],
    href: ({ eventId }) => eventPath(eventId, "sales"),
  },
  {
    key: "stand",
    slug: "stand",
    label: "Stand",
    description: "Drink and food stand: stock, sales and closing reports.",
    icon: "stand",
    module: "stand-mode",
    permission: ["stand:operate", "stand:manage", "sale:create", "event:write"],
    href: ({ eventId }) => eventPath(eventId, "stand"),
  },
  {
    key: "vip",
    slug: "vip",
    label: "VIP guests",
    shortLabel: "VIP",
    description: "The VIP name list and who from it has registered.",
    icon: "vip",
    permission: "booking:read",
    needsVipList: true,
    href: ({ eventId }) => eventPath(eventId, "vip"),
  },
  {
    key: "bus",
    slug: "bus",
    label: "Bus transfers",
    shortLabel: "Bus",
    description: "Routes, seats, captain lists and boarding.",
    icon: "bus",
    module: "bus-transport",
    permission: ["bus:manage", "bus:board", "booking:manage"],
    href: ({ eventId }) => eventPath(eventId, "bus"),
  },
  {
    key: "waitlist",
    slug: "waitlist",
    label: "Waitlist",
    description: "Guests waiting for a place when the event is full.",
    icon: "waitlist",
    module: "waitlist",
    permission: ["waitlist:manage", "booking:manage"],
    href: ({ eventId }) => eventPath(eventId, "waitlist"),
  },
  {
    key: "feedback",
    slug: "feedback",
    label: "Feedback",
    description: "Post-event surveys and on-site ratings.",
    icon: "feedback",
    module: "feedback",
    permission: ["feedback:manage", "event:write"],
    href: ({ eventId }) => eventPath(eventId, "feedback"),
  },
  {
    key: "kiosk",
    slug: "kiosk",
    label: "Kiosk",
    description: "Run a rating kiosk on a tablet at the venue.",
    icon: "kiosk",
    module: "feedback",
    permission: ["feedback:kiosk", "feedback:manage", "event:write"],
    href: ({ eventId }) => eventPath(eventId, "kiosk"),
  },
  {
    key: "emails",
    slug: "emails",
    label: "Emails",
    description: "Scheduled and automatic emails to this event's guests.",
    icon: "emails",
    module: "event-emails",
    permission: ["email:send", "booking:manage"],
    href: ({ eventId }) => eventPath(eventId, "emails"),
  },
  {
    key: "reports",
    slug: "reports",
    label: "Reports",
    description: "Registrations per day and per answer, with Excel export.",
    icon: "reports",
    permission: "booking:read",
    href: ({ eventId }) => eventPath(eventId, "reports"),
  },
  {
    key: "preview",
    slug: "preview",
    label: "Preview",
    description: "Try the form and each view exactly as guests and staff see them.",
    icon: "preview",
    permission: "event:read",
    href: ({ eventId }) => eventPath(eventId, "preview"),
  },
];

/** A tool of an event group (today only hotels): `/admin/groups/[groupId]/<slug>`. */
export interface GroupTool {
  key: string;
  slug: GroupToolSlug;
  label: string;
  description: string;
  icon: EventToolIconKey;
  /** Module that must be on for the group. */
  module?: string;
  permission: string | readonly string[];
  href: (groupId: string) => string;
}

export const GROUP_TOOLS: readonly GroupTool[] = [
  {
    key: "hotels",
    slug: "hotels",
    label: "Hotels",
    description: "Accommodation guests of this group's events can add to their booking.",
    icon: "hotels",
    module: "hotels",
    permission: "hotel:read",
    href: (groupId) => groupPath(groupId, "hotels"),
  },
];

export const GROUP_TOOL_KEYS: readonly string[] = GROUP_TOOLS.map((tool) => tool.key);

/** A link to one workspace tool, as plain serialisable data (server -> client components). */
export interface ToolLink {
  key: string;
  label: string;
  href: string;
  icon: EventToolIconKey | "overview" | "events";
}

/** Tool tabs / sidebar entries for an event: the tools' short labels and hrefs. */
export function eventToolLinks(tools: readonly EventTool[], ctx: EventToolContext): ToolLink[] {
  return tools.map((tool) => ({ key: tool.key, label: tool.shortLabel ?? tool.label, href: tool.href(ctx), icon: tool.icon }));
}

export function groupToolLinks(tools: readonly GroupTool[], groupId: string): ToolLink[] {
  return tools.map((tool) => ({ key: tool.key, label: tool.label, href: tool.href(groupId), icon: tool.icon }));
}

export interface EventToolAccess {
  permissions: Iterable<string>;
  /** Whether a module is on for this event (resolveModules(...).isOn). */
  isOn: (moduleKey: string) => boolean;
  hasVipList?: boolean;
}

/** The tools this event actually has on and this member may open. */
export function filterEventTools(tools: readonly EventTool[], access: EventToolAccess): EventTool[] {
  const granted = new Set(access.permissions);
  return tools.filter(
    (tool) =>
      (!tool.module || access.isOn(tool.module)) &&
      (!tool.needsVipList || access.hasVipList) &&
      hasAnyPermission(granted, tool.permission),
  );
}

export interface GroupToolAccess {
  permissions: Iterable<string>;
  isOn: (moduleKey: string) => boolean;
}

/** The group-level tools that are on for the group and open to this member. */
export function filterGroupTools(tools: readonly GroupTool[], access: GroupToolAccess): GroupTool[] {
  const granted = new Set(access.permissions);
  return tools.filter((tool) => (!tool.module || access.isOn(tool.module)) && hasAnyPermission(granted, tool.permission));
}

/** How the module switches are grouped on an event, in display order. */
export const MODULE_CATEGORIES: ReadonlyArray<{ label: string; keys: readonly string[] }> = [
  { label: "Selling", keys: ["ticket-sales", "point-of-sale", "stand-mode", "free-registration", "waitlist"] },
  { label: "Guests & travel", keys: ["hotels", "bus-transport", "guest-portal"] },
  { label: "Communication", keys: ["event-emails", "feedback"] },
];

/** Splits module rows into the display categories; unknown modules land in "Other". */
export function categorizeModules<T extends { key: string }>(rows: readonly T[]): Array<{ label: string; rows: T[] }> {
  const known = new Set(MODULE_CATEGORIES.flatMap((category) => category.keys));
  const groups = MODULE_CATEGORIES.map((category) => ({
    label: category.label,
    rows: category.keys.map((key) => rows.find((row) => row.key === key)).filter((row): row is T => Boolean(row)),
  }));
  groups.push({ label: "Other", rows: rows.filter((row) => !known.has(row.key)) as T[] });
  return groups.filter((group) => group.rows.length > 0);
}

/** The tool labels a module unlocks, for "Adds: …" hints next to a module switch. */
export function toolLabelsForModule(moduleKey: string): string[] {
  return [...EVENT_TOOLS, ...GROUP_TOOLS].filter((tool) => tool.module === moduleKey).map((tool) => tool.label);
}
