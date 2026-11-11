import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { ActionError } from "@tbook/actions";
import { busTransport } from "@tbook/modules";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { setBoardingAdminAction } from "../../bus-actions";
import { PassengerList } from "../passenger-list";

export const dynamic = "force-dynamic";

export default async function BusRoutePage({ params }: { params: Promise<{ routeId: string }> }) {
  const { routeId } = await params;
  const { organizationId } = await requireAdminPage("bus:manage");
  const route = await busTransport.getRouteForOrg(organizationId, routeId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!route) notFound();
  const passengers = await busTransport.listPassengers(route);

  async function setBoarding(attendeeKey: string, leg: "outbound" | "return", status: "boarded" | "not_boarded" | null) {
    "use server";
    return setBoardingAdminAction(routeId, attendeeKey, leg, status);
  }

  return (
    <>
      <PageTitle
        title={`${route.code} · ${route.city}`}
        description={[route.pickupPoint, busTransport.formatDeparture(route.departureAt), route.captainName && `captain: ${route.captainName} ${route.captainPhone}`].filter(Boolean).join(" · ")}
        back={{ href: `/admin/bus?eventId=${String(route.eventId)}`, label: "Buses" }}
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/bus/export?eventId=${String(route.eventId)}&routeId=${routeId}`} prefetch={false}>
              <Download /> Export (xlsx)
            </Link>
          </Button>
        }
      />
      <SectionCard title={`Passengers (${passengers.length} / ${route.capacity})`}>
        <PassengerList
          passengers={passengers.map((p) => ({ attendeeKey: p.attendeeKey, name: p.name, registrationNumber: p.registrationNumber, phone: p.phone, outbound: p.outbound, return: p.return }))}
          onSet={setBoarding}
          refreshSeconds={30}
        />
      </SectionCard>
    </>
  );
}
