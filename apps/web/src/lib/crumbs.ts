import { EVENT_TOOLS, GROUP_TOOLS } from "./event-tools";
import { eventPath, groupPath, routeContext, type EventToolSlug, type GroupToolSlug } from "./event-routes";

export interface Crumb {
  /** null = the name isn't known yet (the header renders a placeholder, never "Details"). */
  label: string | null;
  href: string;
}

/** Names the header knows for the event / group in the path (from the workspace registrar or the cached lookup). */
export interface CrumbNames {
  event?: string | null;
  group?: string | null;
}

/** Path segments that read better than their raw URL form. */
const SEGMENT_LABELS: Record<string, string> = {
  admin: "Home",
  "check-in": "Check-in",
  "select-org": "Select organization",
  members: "Team",
  email: "Booking email",
  new: "New",
  vip: "VIP guests",
  "device-link": "Device link",
  merch: "Merch register",
  data: "Data lists",
  groups: "Event groups",
  products: "Products",
};

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export function segmentLabel(segment: string): string {
  if (OBJECT_ID.test(segment)) return "Details";
  return SEGMENT_LABELS[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
}

function toolLabel(kind: "event" | "group", slug: string): string {
  const tool = kind === "event" ? EVENT_TOOLS.find((candidate) => candidate.slug === slug) : GROUP_TOOLS.find((candidate) => candidate.slug === slug);
  if (!tool) return segmentLabel(slug);
  return ("shortLabel" in tool && tool.shortLabel) || tool.label;
}

/**
 * The breadcrumb trail for a pathname.
 *   /admin/events/<id>/bus/<routeId>  →  Events › <event name> › Bus › Details
 *   /admin/groups/<id>/hotels         →  Event groups › <group name> › Hotels
 *   /admin/bookings/<id>              →  Home › Bookings › Details
 */
export function buildCrumbs(pathname: string, names: CrumbNames): Crumb[] {
  const segments = pathname.split("?")[0]!.split("/").filter(Boolean);
  const context = routeContext(pathname);

  if (context.kind === "event") {
    const rest = segments.slice(3);
    const crumbs: Crumb[] = [
      { label: "Events", href: "/admin/events" },
      { label: names.event ?? null, href: eventPath(context.eventId) },
    ];
    if (context.tool) {
      crumbs.push({ label: toolLabel("event", context.tool), href: eventPath(context.eventId, context.tool as EventToolSlug) });
      rest.shift();
    }
    return [...crumbs, ...trail(segments.slice(0, 3 + (context.tool ? 1 : 0)), rest)];
  }
  if (context.kind === "group") {
    const rest = segments.slice(3);
    const crumbs: Crumb[] = [
      { label: "Event groups", href: "/admin/groups" },
      { label: names.group ?? null, href: groupPath(context.groupId) },
    ];
    if (context.tool) {
      crumbs.push({ label: toolLabel("group", context.tool), href: groupPath(context.groupId, context.tool as GroupToolSlug) });
      rest.shift();
    }
    return [...crumbs, ...trail(segments.slice(0, 3 + (context.tool ? 1 : 0)), rest)];
  }
  return segments.map((segment, index) => ({ label: segmentLabel(segment), href: `/${segments.slice(0, index + 1).join("/")}` }));
}

/** Remaining segments after the known prefix, each linking to its own path. */
function trail(prefix: string[], rest: string[]): Crumb[] {
  return rest.map((segment, index) => ({ label: segmentLabel(segment), href: `/${[...prefix, ...rest.slice(0, index + 1)].join("/")}` }));
}
