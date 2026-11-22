"use client";

import { usePathname, useRouter } from "next/navigation";
import { NativeSelect } from "@/components/form-bits";
import { routeContext, switchEventInPath } from "@/lib/event-routes";

/**
 * Switches to another event. Inside an event workspace
 * (/admin/events/<id>/…) it keeps the current tool (`switchEventInPath`);
 * on a station-index page (check-in, sales, stand pickers) it keeps the old
 * `basePath?eventId=` behaviour. Pages inside the workspace don't need it:
 * the workspace header has an event switcher.
 */
export function EventPicker({ events, value, basePath }: { events: Array<{ id: string; name: string }>; value: string; basePath: string }) {
  const router = useRouter();
  const pathname = usePathname();
  function go(eventId: string) {
    if (routeContext(pathname).kind === "event") router.push(switchEventInPath(pathname, eventId));
    else router.push(`${basePath}${basePath.includes("?") ? "&" : "?"}eventId=${eventId}`);
  }
  return (
    <NativeSelect aria-label="Event" value={value} className="w-64" onChange={(e) => go(e.target.value)}>
      {events.map((event) => (
        <option key={event.id} value={event.id}>
          {event.name}
        </option>
      ))}
    </NativeSelect>
  );
}
