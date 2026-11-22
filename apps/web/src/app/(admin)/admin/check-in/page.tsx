import Link from "next/link";
import { CalendarX, ChevronRight, DoorOpen } from "lucide-react";
import { listBookingFilterOptions } from "@tbook/services";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";

/**
 * Event picker for the door. Deliberately a separate step from the roster:
 * scanning is always scoped to one event so a ticket for the wrong day
 * reports "wrong event" rather than being admitted.
 */
export const dynamic = "force-dynamic";

export default async function CheckInIndexPage() {
  const { organizationId } = await requireAdminPage("voucher:read");
  const { events } = await listBookingFilterOptions(organizationId);

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
          </KpiGrid>
          <ul className="grid gap-3 sm:grid-cols-2 md:gap-4 xl:grid-cols-3">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/admin/check-in/${event.id}`}
                  className="focus-visible:ring-ring/50 group block rounded-xl outline-none focus-visible:ring-[3px]"
                >
                  <Card className="group-hover:border-ring/60 group-hover:bg-muted/40 flex-row items-center gap-3 p-4 shadow-xs transition-colors">
                    <span className="bg-info-soft text-info-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                      <DoorOpen className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{event.name}</span>
                      <span className="text-muted-foreground block text-xs">Open door</span>
                    </span>
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
