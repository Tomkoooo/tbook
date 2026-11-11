import Link from "next/link";
import { Bus, Download } from "lucide-react";
import { BUS_TRANSPORT, busTransport } from "@tbook/modules";
import { listEventsForOrg, resolveModules } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { BusEventPicker, BusRouteDialog, BusRouteRowActions, RecountSeatsButton } from "./bus-controls";

export const dynamic = "force-dynamic";

function toDateTimeLocal(date: Date | null): string {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default async function BusPage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const { eventId: requested } = await searchParams;
  const { organizationId } = await requireAdminPage("bus:manage");

  const events = await listEventsForOrg(organizationId);
  const busEvents = [];
  for (const event of events) {
    if ((await resolveModules({ organizationId, event })).isOn(BUS_TRANSPORT)) busEvents.push(event);
  }
  const event = busEvents.find((e) => String(e._id) === requested) ?? busEvents[0] ?? null;

  if (!event) {
    return (
      <>
        <PageTitle title="Buses" />
        <SectionCard>
          <EmptyState icon={<Bus />} title="No event uses bus transport" hint="Switch on “Bus transport” in an event's Modules section." />
        </SectionCard>
      </>
    );
  }

  const eventId = String(event._id);
  const routes = await busTransport.listRoutes(eventId);
  const passengers = await Promise.all(routes.map((route) => busTransport.listPassengers(route)));
  const totals = routes.reduce((sum, route) => ({ seats: sum.seats + route.capacity, taken: sum.taken + route.seatsTaken }), { seats: 0, taken: 0 });

  return (
    <>
      <PageTitle
        title="Buses"
        description="Routes guests choose at registration, their seats, captains and boarding."
        actions={
          <>
            {busEvents.length > 1 ? <BusEventPicker events={busEvents.map((e) => ({ id: String(e._id), name: e.name }))} value={eventId} /> : null}
            <Button asChild variant="outline">
              <Link href={`/admin/bus/export?eventId=${eventId}`} prefetch={false}>
                <Download /> Export (xlsx)
              </Link>
            </Button>
            <BusRouteDialog eventId={eventId} route={null} />
          </>
        }
      />
      <SectionCard
        title={`${event.name} — ${routes.length} buses`}
        description={`${totals.taken} of ${totals.seats} seats taken. Bulk-add buses from a spreadsheet on the Data page.`}
        actions={<RecountSeatsButton eventId={eventId} />}
        flush
      >
        {routes.length === 0 ? (
          <EmptyState title="No buses yet" hint="Add one, or import the route list (Data → Import → Bus routes)." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bus</TableHead>
                <TableHead>Pickup</TableHead>
                <TableHead className="text-right">Seats</TableHead>
                <TableHead>Captain</TableHead>
                <TableHead className="text-right">Outbound</TableHead>
                <TableHead className="text-right">Return</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routes.map((route, index) => {
                const list = passengers[index] ?? [];
                const out = busTransport.legCounts(list, "outbound");
                const back = busTransport.legCounts(list, "return");
                const routeId = String(route._id);
                return (
                  <TableRow key={routeId}>
                    <TableCell>
                      <Link href={`/admin/bus/${routeId}`} className="font-medium hover:underline">
                        {route.code} · {route.city}
                      </Link>
                      {!route.active ? (
                        <Badge variant="warning" className="ml-2">
                          hidden
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {route.pickupPoint || "—"}
                      <div className="text-muted-foreground text-xs">{busTransport.formatDeparture(route.departureAt)}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {route.seatsTaken} / {route.capacity}
                    </TableCell>
                    <TableCell>
                      {route.captainName || "—"}
                      <div className="text-muted-foreground text-xs">
                        {route.captainPhone}
                        {route.captainTokenHash ? ` · link …${route.captainTokenHint}` : " · no link"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {out.boarded}/{out.booked}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {back.boarded}/{back.booked}
                    </TableCell>
                    <TableCell className="text-right">
                      <BusRouteRowActions
                        eventId={eventId}
                        hasLink={Boolean(route.captainTokenHash)}
                        route={{
                          id: routeId,
                          code: route.code,
                          city: route.city,
                          pickupPoint: route.pickupPoint,
                          departureAt: toDateTimeLocal(route.departureAt),
                          returnInfo: route.returnInfo,
                          capacity: route.capacity,
                          captainName: route.captainName,
                          captainPhone: route.captainPhone,
                          notes: route.notes,
                          active: route.active,
                          sortOrder: route.sortOrder,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
