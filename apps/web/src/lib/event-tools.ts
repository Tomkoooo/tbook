import { hasAnyPermission } from "./nav-config";

/**
 * The per-event tools: pages that used to crowd the global sidebar and now
 * hang off an event (or event group). Each tool names the module that must
 * be on for that event and the permission the page needs. Pure data plus a
 * filter so it can be unit tested.
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
  | "data"
  | "preview";

export interface EventToolContext {
  eventId: string;
  groupId: string | null;
}

export interface EventTool {
  key: string;
  label: string;
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

export const EVENT_TOOLS: readonly EventTool[] = [
  {
    key: "bookings",
    label: "Guests & bookings",
    description: "Everyone registered or booked, with details and vouchers.",
    icon: "bookings",
    module: "ticket-sales",
    permission: "booking:read",
    href: ({ eventId }) => `/admin/bookings?eventId=${eventId}`,
  },
  {
    key: "check-in",
    label: "Check-in",
    description: "Scan tickets at the door and see who has arrived.",
    icon: "checkin",
    module: "ticket-sales",
    permission: "voucher:read",
    href: ({ eventId }) => `/admin/check-in/${eventId}`,
  },
  {
    key: "sales",
    label: "Point of sale",
    description: "Sell tickets and merchandise at the counter.",
    icon: "pos",
    module: "point-of-sale",
    permission: ["sale:create", "booking:manage"],
    href: ({ eventId }) => `/admin/sales?eventId=${eventId}`,
  },
  {
    key: "stand",
    label: "Stand",
    description: "Drink and food stand: stock, sales and closing reports.",
    icon: "stand",
    module: "stand-mode",
    permission: ["stand:operate", "stand:manage", "sale:create", "event:write"],
    href: ({ eventId }) => `/admin/stand?eventId=${eventId}`,
  },
  {
    key: "vip",
    label: "VIP guests",
    description: "The VIP name list and who from it has registered.",
    icon: "vip",
    permission: "booking:read",
    needsVipList: true,
    href: ({ eventId }) => `/admin/vip?eventId=${eventId}`,
  },
  {
    key: "hotels",
    label: "Hotels",
    description: "Accommodation guests can add to their booking.",
    icon: "hotels",
    module: "hotels",
    permission: "hotel:read",
    href: ({ groupId }) => (groupId ? `/admin/hotels?groupId=${groupId}` : "/admin/hotels"),
  },
  {
    key: "bus",
    label: "Bus transfers",
    description: "Routes, seats, captain lists and boarding.",
    icon: "bus",
    module: "bus-transport",
    permission: ["bus:manage", "bus:board", "booking:manage"],
    href: ({ eventId }) => `/admin/bus?eventId=${eventId}`,
  },
  {
    key: "waitlist",
    label: "Waitlist",
    description: "Guests waiting for a place when the event is full.",
    icon: "waitlist",
    module: "waitlist",
    permission: ["waitlist:manage", "booking:manage"],
    href: ({ eventId }) => `/admin/waitlist?eventId=${eventId}`,
  },
  {
    key: "feedback",
    label: "Feedback",
    description: "Post-event surveys and on-site ratings.",
    icon: "feedback",
    module: "feedback",
    permission: ["feedback:manage", "event:write"],
    href: ({ eventId }) => `/admin/feedback?eventId=${eventId}`,
  },
  {
    key: "kiosk",
    label: "Kiosk",
    description: "Run a rating kiosk on a tablet at the venue.",
    icon: "kiosk",
    module: "feedback",
    permission: ["feedback:kiosk", "feedback:manage", "event:write"],
    href: () => "/admin/kiosk",
  },
  {
    key: "emails",
    label: "Emails",
    description: "Scheduled and automatic emails to this event's guests.",
    icon: "emails",
    module: "event-emails",
    permission: ["email:send", "booking:manage"],
    href: ({ eventId }) => `/admin/emails?eventId=${eventId}`,
  },
  {
    key: "reports",
    label: "Reports",
    description: "Registrations per day and per answer, with Excel export.",
    icon: "reports",
    permission: "booking:read",
    href: ({ eventId }) => `/admin/reports?eventId=${eventId}`,
  },
  {
    key: "data",
    label: "Data",
    description: "Name lists used for registration checks and emails.",
    icon: "data",
    permission: ["list:manage", "event:write"],
    href: () => "/admin/data",
  },
  {
    key: "preview",
    label: "Preview",
    description: "Try the form and each view exactly as guests and staff see them.",
    icon: "preview",
    permission: "event:read",
    href: ({ eventId }) => `/admin/preview?eventId=${eventId}`,
  },
];

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

/**
 * The tools that make sense for a whole event group: only the ones that
 * live at group level (hotels). Everything else belongs to one event.
 */
export const GROUP_TOOL_KEYS: readonly string[] = ["hotels"];

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
  return EVENT_TOOLS.filter((tool) => tool.module === moduleKey).map((tool) => tool.label);
}
