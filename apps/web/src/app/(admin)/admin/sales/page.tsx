import Link from "next/link";
import { CalendarX, ChevronRight, Shirt, Ticket } from "lucide-react";
import { POINT_OF_SALE } from "@tbook/modules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { formatDate, requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { requireModule } from "@/lib/require-module";
import { stationEvents } from "@/lib/station-events-server";

export const dynamic = "force-dynamic";

/**
 * Station picker for the counter: the events on sale with the point of sale
 * switched on, today's first. The ticket POS itself lives at
 * /admin/events/[eventId]/sales; the merch register is /admin/merch.
 */
export default async function SalesPickerPage() {
  const { organizationId, permissions } = await requireAdminPage();
  const off = await requireModule(organizationId, POINT_OF_SALE, "Point of sale");
  if (off) return off;
  if (!hasPermissionOrFallback(permissions, "sale:create") && !hasPermissionOrFallback(permissions, "booking:manage")) {
    return (
      <>
        <PageTitle title="Point of sale" description="You don't have permission to sell tickets." />
        <Notice tone="warning">Ask an organization admin for the sale:create permission.</Notice>
      </>
    );
  }

  const events = await stationEvents(organizationId, POINT_OF_SALE, { activeOnly: true });

  return (
    <>
      <PageTitle
        title="Point of sale"
        description="Pick the event you're selling tickets for."
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/merch">
              <Shirt /> Merch register
            </Link>
          </Button>
        }
      />
      {events.length === 0 ? (
        <EmptyState
          variant="hero"
          icon={<CalendarX />}
          title="Nothing on sale"
          hint="There are no active events. Activate one under Events first."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 md:gap-4 xl:grid-cols-3">
          {events.map(({ event, today }) => {
            const left = event.capacity == null ? null : Math.max(event.capacity - (event.soldGuestCount ?? 0), 0);
            const scarce = left !== null && event.capacity ? left / event.capacity <= 0.1 : false;
            return (
              <li key={String(event._id)}>
                <Link
                  href={eventPath(String(event._id), "sales")}
                  className="focus-visible:ring-ring/50 group block rounded-xl outline-none focus-visible:ring-[3px]"
                >
                  <Card className="group-hover:border-ring/60 group-hover:bg-muted/40 flex-row items-center gap-3 p-4 shadow-xs transition-colors">
                    <span className="bg-info-soft text-info-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                      <Ticket className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{event.name}</span>
                      <span className="text-muted-foreground block text-xs">{event.startDate ? formatDate(event.startDate) : "No date"}</span>
                    </span>
                    {today ? <Badge variant="success">Today</Badge> : null}
                    {left === null ? (
                      <Badge variant="neutral">No limit</Badge>
                    ) : left === 0 ? (
                      <Badge variant="danger">Sold out</Badge>
                    ) : (
                      <Badge variant={scarce ? "warning" : "success"}>{left} left</Badge>
                    )}
                    <ChevronRight className="text-muted-foreground size-5 shrink-0" />
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
