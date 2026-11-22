/**
 * The console's route model: the URL carries the business context.
 *
 *   org                         /admin/…                       (the active organization comes from the session)
 *   event group  (owns hotels)  /admin/groups/[groupId]/…
 *   event        (owns the day-of tools: guests, door, POS, bus, stand…)
 *                               /admin/events/[eventId]/…
 *
 * Never put an event in `?eventId=` again — build every link to an event tool
 * with `eventPath`, every link to a group tool with `groupPath`. See
 * docs/console-structure.md for the full map and the reasoning.
 */

/** Tools that live under an event: `/admin/events/[eventId]/<slug>`. */
export const EVENT_TOOL_SLUGS = ["bookings", "check-in", "sales", "stand", "bus", "waitlist", "feedback", "kiosk", "emails", "vip", "reports", "preview"] as const;
export type EventToolSlug = (typeof EVENT_TOOL_SLUGS)[number];

/** Tools that live under an event group: `/admin/groups/[groupId]/<slug>`. */
export const GROUP_TOOL_SLUGS = ["hotels"] as const;
export type GroupToolSlug = (typeof GROUP_TOOL_SLUGS)[number];

function join(base: string, rest: ReadonlyArray<string | undefined>, query?: Record<string, string | undefined>): string {
  const path = [base, ...rest.filter((part): part is string => Boolean(part))].join("/");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** `eventPath(id)` → the event's overview; `eventPath(id, "bus", routeId)` → `/admin/events/<id>/bus/<routeId>`. */
export function eventPath(eventId: string, tool?: EventToolSlug, ...rest: string[]): string {
  return join(`/admin/events/${eventId}`, [tool, ...rest]);
}

/** Same, with a query string (filters, `view`, …) — never `eventId`. */
export function eventPathWith(eventId: string, tool: EventToolSlug, query: Record<string, string | undefined>, ...rest: string[]): string {
  return join(`/admin/events/${eventId}`, [tool, ...rest], query);
}

export function groupPath(groupId: string, tool?: GroupToolSlug, ...rest: string[]): string {
  return join(`/admin/groups/${groupId}`, [tool, ...rest]);
}

const EVENT_PREFIX = /^\/admin\/events\/([0-9a-f]{24})(?=[/?#]|$)(?:\/([^/?#]+))?/i;
const GROUP_PREFIX = /^\/admin\/groups\/([0-9a-f]{24})(?=[/?#]|$)(?:\/([^/?#]+))?/i;

/** What business context a pathname is in (for the shell: sidebar section, breadcrumbs). */
export type RouteContext =
  | { kind: "event"; eventId: string; tool: EventToolSlug | null }
  | { kind: "group"; groupId: string; tool: GroupToolSlug | null }
  | { kind: "org" };

export function routeContext(pathname: string): RouteContext {
  const event = EVENT_PREFIX.exec(pathname);
  if (event) {
    const slug = event[2];
    return { kind: "event", eventId: event[1]!, tool: (EVENT_TOOL_SLUGS as readonly string[]).includes(slug ?? "") ? (slug as EventToolSlug) : null };
  }
  const group = GROUP_PREFIX.exec(pathname);
  if (group) {
    const slug = group[2];
    return { kind: "group", groupId: group[1]!, tool: (GROUP_TOOL_SLUGS as readonly string[]).includes(slug ?? "") ? (slug as GroupToolSlug) : null };
  }
  return { kind: "org" };
}

/** Swaps the event in an event-scoped path, keeping the tool: used by the event switcher. */
export function switchEventInPath(pathname: string, newEventId: string): string {
  const ctx = routeContext(pathname);
  return ctx.kind === "event" ? eventPath(newEventId, ctx.tool ?? undefined) : eventPath(newEventId);
}
