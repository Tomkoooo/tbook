"use client";

import { usePathname, useRouter } from "next/navigation";
import { NativeSelect } from "@/components/form-bits";
import { switchEventInPath } from "@/lib/event-routes";

/**
 * Jumps to another event of the organization while keeping the current tool
 * (bus stays bus). Lives in the event workspace header.
 */
export function EventSwitcher({ events, value }: { events: Array<{ id: string; name: string }>; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (events.length < 2) return null;
  return (
    <NativeSelect aria-label="Switch event" value={value} className="w-full sm:w-64" onChange={(e) => router.push(switchEventInPath(pathname, e.target.value))}>
      {events.map((event) => (
        <option key={event.id} value={event.id}>
          {event.name}
        </option>
      ))}
    </NativeSelect>
  );
}
