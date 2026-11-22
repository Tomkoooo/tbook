import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { ActionError } from "@tbook/actions";
import { BUS_TRANSPORT, busTransport } from "@tbook/modules";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { eventPath, eventPathWith } from "@/lib/event-routes";
import { requireEvent, requireEventModule } from "@/lib/require-module";
import { setBoardingAdminAction } from "@/app/(admin)/admin/bus-actions";
import { PassengerList } from "@/components/bus/passenger-list";

export const dynamic = "force-dynamic";

export default async function BusRoutePage({ params }: { params: Promise<{ eventId: string; routeId: string }> }) {
  const { eventId, routeId } = await params;
  const { organizationId, permissions } = await requireAdminPage("bus:board");
  const canManage = hasPermissionOrFallback(permissions, "bus:manage");
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, BUS_TRANSPORT, "Bus transfers");
  if (off) return off;
  const route = await busTransport.getRouteForOrg(organizationId, routeId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!route || String(route.eventId) !== eventId) notFound();
  const passengers = await busTransport.listPassengers(route);

  async function setBoarding(attendeeKey: string, leg: "outbound" | "return", status: "boarded" | "not_boarded" | null) {
    "use server";
    return setBoardingAdminAction(routeId, attendeeKey, leg, status);
  }

  return (
    <>
      <PageTitle
        title={`${route.code} · ${route.city}`}
        description={[
          ...(route.stops?.length ? busTransport.routeStops(route).map((stop) => busTransport.stopShortLabel(stop)) : [route.pickupPoint, busTransport.formatDeparture(route.departureAt)]),
          route.captainName && `captain: ${route.captainName} ${route.captainPhone}`].filter(Boolean).join(" · ")}
        back={{ href: eventPath(eventId, "bus"), label: "Buses" }}
        actions={
          canManage ? (
            <Button asChild variant="outline">
              <Link href={eventPathWith(eventId, "bus", { routeId }, "export")} prefetch={false}>
                <Download /> Export (xlsx)
              </Link>
            </Button>
          ) : undefined
        }
      />
      <SectionCard title={`Passengers (${passengers.length} / ${route.capacity})`}>
        <PassengerList
          passengers={passengers.map((p) => ({ attendeeKey: p.attendeeKey, name: p.name, registrationNumber: p.registrationNumber, phone: p.phone, stop: route.stops?.length ? p.stop : "", outbound: p.outbound, return: p.return }))}
          onSet={setBoarding}
          refreshSeconds={30}
        />
      </SectionCard>
    </>
  );
}
