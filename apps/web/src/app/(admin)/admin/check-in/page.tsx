import Link from "next/link";
import { CalendarX, ChevronRight, DoorOpen } from "lucide-react";
import { TICKET_SALES } from "@tbook/modules";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { PageTitle } from "@/components/page-title";
import { formatDate, requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";
import { requireModule } from "@/lib/require-module";
import { stationEvents } from "@/lib/station-events-server";

/**
 * Station picker for the door: events with ticket sales on, today's first.
 * Deliberately a separate step from the roster — scanning is always scoped to
 * one event so a ticket for the wrong day reports "wrong event" rather than
 * being admitted. The roster itself lives at /admin/events/[eventId]/check-in.
 */
export const dynamic = "force-dynamic";

export default async function CheckInIndexPage() {
  const { organizationId } = await requireAdminPage("voucher:read");
  const off = await requireModule(organizationId, TICKET_SALES, "Ticket selling");
  if (off) return off;
  const events = await stationEvents(organizationId, TICKET_SALES);
  const todayCount = events.filter((row) => row.today).length;

  return (
    <>
      <PageTitle title="Check-in" description="Pick the event you're working the door for." />

      {events.length === 0 ? (
        <EmptyState
          variant="hero"
          icon={<CalendarX />}
          title="No events yet"
          hint="Create an event first — entries are issued per event."
        />
      ) : (
        <>
          <KpiGrid cols={3}>
            <KpiTile label="Events" value={events.length} hint="available at the door" icon={<DoorOpen />} tone="info" />
            <KpiTile label="Today" value={todayCount} hint="running today" icon={<DoorOpen />} tone={todayCount > 0 ? "success" : "neutral"} />
          </KpiGrid>
          <ul className="grid gap-3 sm:grid-cols-2 md:gap-4 xl:grid-cols-3">
            {events.map(({ event, today }) => (
              <li key={String(event._id)}>
                <Link
                  href={eventPath(String(event._id), "check-in")}
                  className="focus-visible:ring-ring/50 group block rounded-xl outline-none focus-visible:ring-[3px]"
                >
                  <Card className="group-hover:border-ring/60 group-hover:bg-muted/40 flex-row items-center gap-3 p-4 shadow-xs transition-colors">
                    <span className="bg-info-soft text-info-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                      <DoorOpen className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{event.name}</span>
                      <span className="text-muted-foreground block text-xs">{formatDate(event.startDate)}</span>
                    </span>
                    {today ? <Badge variant="success">Today</Badge> : null}
                    <ChevronRight className="text-muted-foreground size-5 shrink-0" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
