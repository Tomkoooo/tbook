import Link from "next/link";
import { CalendarX, ChevronRight, Store } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";
import { standEvents } from "@/lib/stand-events";

/**
 * Station picker for the stand: the events that have stand mode on, today's
 * first. The sell screen and the stand tools live under the event
 * (`/admin/events/[eventId]/stand`); with a single candidate we go straight there.
 */
export const dynamic = "force-dynamic";

export default async function StandIndexPage() {
  const { organizationId } = await requireAdminPage("stand:operate");
  const events = await standEvents(organizationId);
  if (events.length === 1) redirect(eventPath(String(events[0]!.event._id), "stand"));

  return (
    <>
      <PageTitle title="Pult" description="Válaszd ki az eseményt, amelynek a pultját viszed." />
      {events.length === 0 ? (
        <EmptyState
          variant="hero"
          icon={<CalendarX />}
          title="No event uses stand mode"
          hint="Switch on “Stand mode” in an event's Modules section."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 md:gap-4 xl:grid-cols-3">
          {events.map(({ event, today }) => (
            <li key={String(event._id)}>
              <Link href={eventPath(String(event._id), "stand")} className="focus-visible:ring-ring/50 group block rounded-xl outline-none focus-visible:ring-[3px]">
                <Card className="group-hover:border-ring/60 group-hover:bg-muted/40 flex-row items-center gap-3 p-4 shadow-xs transition-colors">
                  <span className="bg-info-soft text-info-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                    <Store className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{event.name}</span>
                    {today ? <Badge variant="success">ma</Badge> : null}
                  </span>
                  <ChevronRight className="text-muted-foreground size-5 shrink-0" />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
