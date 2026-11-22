import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { eventPath } from "@/lib/event-routes";
import { eventDateLabel } from "@/lib/home-data";
import type { HomeEventView } from "./load-home";
import { toolIcon } from "./icons";

/** One event with the big one-tap shortcuts this member may use for it. */
export function HomeEventCard({ event, live, canOpenEvent }: { event: HomeEventView; live: boolean; canOpenEvent: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          {event.name}
          {live ? <Badge variant="success">Today</Badge> : <Badge variant="neutral">Upcoming</Badge>}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-4" /> {eventDateLabel(event.startDate, event.endDate)}
          </span>
          {event.address ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" /> {event.address}
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {event.shortcuts.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {event.shortcuts.map((shortcut) => {
              const Icon = toolIcon(shortcut.icon);
              return (
                <Button key={shortcut.key} size="lg" variant={shortcut.key === event.shortcuts[0]!.key ? "default" : "secondary"} className="h-auto min-h-14 justify-start px-4 py-3 text-base [&_svg:not([class*='size-'])]:size-6" asChild>
                  <Link href={shortcut.href}>
                    <Icon /> {shortcut.label}
                  </Link>
                </Button>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Your role has no day-of tools for this event.</p>
        )}
        {canOpenEvent ? (
          <div>
            <Button variant="link" size="sm" className="px-0" asChild>
              <Link href={eventPath(event.id)}>Event overview</Link>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
