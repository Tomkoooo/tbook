"use client";

import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/form-bits";

/** Switches a per-event console page to another event (`?eventId=`). */
export function EventPicker({ events, value, basePath }: { events: Array<{ id: string; name: string }>; value: string; basePath: string }) {
  const router = useRouter();
  return (
    <NativeSelect aria-label="Event" value={value} className="w-64" onChange={(e) => router.push(`${basePath}${basePath.includes("?") ? "&" : "?"}eventId=${e.target.value}`)}>
      {events.map((event) => (
        <option key={event.id} value={event.id}>
          {event.name}
        </option>
      ))}
    </NativeSelect>
  );
}
