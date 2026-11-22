import { dayKeyOf, eventDayKeys, todayDayKey } from "@tbook/domain";
import { EVENT_TOOLS, filterEventTools, type EventToolIconKey } from "./event-tools";
import { filterNavGroups, type NavGroup, type NavItem } from "./nav-config";

/**
 * Pure helpers behind the home page ("/"): which events to show a member
 * today, and which one-tap shortcuts they get for each. No I/O so it can be
 * unit tested; components/home/load-home.ts does the fetching.
 */

export interface HomeEventInput {
  id: string;
  name: string;
  status: string;
  startDate: Date;
  endDate: Date;
  groupId: string | null;
  location?: { address?: string | null } | null;
}

export type HomeEventsMode = "today" | "upcoming" | "none";

/** How many upcoming events are listed when nothing is happening today. */
export const UPCOMING_LIMIT = 3;

/**
 * The events a member should see first. Only active events count. If any is
 * on today (Europe/Budapest day within start..end) those are returned;
 * otherwise the next few that haven't started yet.
 */
export function pickHomeEvents<T extends HomeEventInput>(events: readonly T[], now: Date, limit = UPCOMING_LIMIT): { mode: HomeEventsMode; events: T[] } {
  const today = todayDayKey(now);
  const active = events.filter((event) => event.status === "active");
  const byStart = (a: T, b: T) => a.startDate.getTime() - b.startDate.getTime() || a.name.localeCompare(b.name);

  const happeningToday = active.filter((event) => eventDayKeys(event.startDate, event.endDate).includes(today)).sort(byStart);
  if (happeningToday.length > 0) return { mode: "today", events: happeningToday };

  const upcoming = active.filter((event) => dayKeyOf(event.startDate) > today).sort(byStart).slice(0, limit);
  return upcoming.length > 0 ? { mode: "upcoming", events: upcoming } : { mode: "none", events: [] };
}

/** The tools that run on the day itself, in the order a phone shows them. */
export const OPERATIONAL_TOOL_KEYS = ["check-in", "sales", "stand", "bus", "kiosk", "bookings", "waitlist"] as const;

export interface EventShortcut {
  key: string;
  label: string;
  description: string;
  icon: EventToolIconKey;
  href: string;
}

/**
 * The operational shortcuts one member may use for one event: the event's
 * module switches and the member's permissions (fallbacks included) decide,
 * exactly like the event page does.
 */
export function buildEventShortcuts(
  access: { permissions: Iterable<string>; isOn: (moduleKey: string) => boolean; hasVipList?: boolean },
  ctx: { eventId: string; groupId: string | null },
): EventShortcut[] {
  const allowed = new Map(filterEventTools(EVENT_TOOLS, access).map((tool) => [tool.key, tool]));
  return OPERATIONAL_TOOL_KEYS.flatMap((key) => {
    const tool = allowed.get(key);
    return tool ? [{ key: tool.key, label: tool.label, description: tool.description, icon: tool.icon, href: tool.href(ctx) }] : [];
  });
}

/** The org-level pages a member can open (the dashboard itself is the "Open admin console" button). */
export function buildOrgLinks(groups: readonly NavGroup[], access: { permissions: Iterable<string>; modules: Iterable<string> }): NavItem[] {
  return filterNavGroups(groups, access)
    .flatMap((group) => group.items)
    .filter((item) => item.href !== "/admin");
}

/** "22 Nov 2026" or "21 Nov – 23 Nov 2026"; days are read the way eventDayKeys reads them (UTC date part). */
export function eventDateLabel(startDate: Date, endDate: Date): string {
  const fmt = (date: Date, withYear: boolean) =>
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(date);
  return dayKeyOf(startDate) === dayKeyOf(endDate) ? fmt(startDate, true) : `${fmt(startDate, false)} – ${fmt(endDate, true)}`;
}

/** Whether the organization picker must be shown: several orgs and no usable active one. */
export function needsOrgChoice(args: { organizationCount: number; hasValidActiveOrg: boolean; isSystemAdmin: boolean }): boolean {
  return !args.isSystemAdmin && !args.hasValidActiveOrg && args.organizationCount > 1;
}

/** The one organization to select automatically: exactly one membership, none active. */
export function soleOrganizationToSelect<T extends { id: string }>(args: { organizations: readonly T[]; hasValidActiveOrg: boolean; isSystemAdmin: boolean }): T | null {
  return !args.isSystemAdmin && !args.hasValidActiveOrg && args.organizations.length === 1 ? args.organizations[0]! : null;
}
