import "@/lib/register-modules";
import type { Metadata } from "next";
import { BUS_TRANSPORT, busTransport } from "@tbook/modules";
import { eventRepository } from "@tbook/db";
import { resolveModules } from "@tbook/services";
import { PassengerList } from "@/app/(admin)/admin/bus/passenger-list";
import { captainSetBoardingAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Buszkapitány", robots: { index: false, follow: false } };

/**
 * Bus captain's page, opened from the link the organizer sends. No login:
 * the unguessable link is the access, and it shows this one bus only.
 */
export default async function CaptainPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const route = await busTransport.findRouteByCaptainToken(token);
  const event = route ? await eventRepository.findById(String(route.eventId)) : null;
  const enabled = event ? (await resolveModules({ event })).isOn(BUS_TRANSPORT) : false;

  if (!route || !event || !enabled) {
    return (
      <main className="mx-auto grid min-h-svh max-w-md place-items-center p-4">
        <div className="bg-card grid gap-2 rounded-xl border p-6 text-center">
          <h1 className="text-lg font-semibold">A link nem érvényes</h1>
          <p className="text-muted-foreground text-sm">Lehet, hogy a szervező új linket készített. Kérd el tőle a frisset.</p>
        </div>
      </main>
    );
  }

  const passengers = await busTransport.listPassengers(route);

  async function setBoarding(attendeeKey: string, leg: "outbound" | "return", status: "boarded" | "not_boarded" | null) {
    "use server";
    return captainSetBoardingAction(token, attendeeKey, leg, status);
  }

  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4 pb-16">
      <header className="grid gap-1">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="text-2xl font-semibold">
          {route.code} · {route.city}
        </h1>
        <p className="text-muted-foreground text-sm">
          {[route.pickupPoint, busTransport.formatDeparture(route.departureAt)].filter(Boolean).join(" · ")}
          {route.returnInfo ? ` · vissza: ${route.returnInfo}` : ""}
        </p>
      </header>
      <PassengerList
        lang="hu"
        refreshSeconds={20}
        passengers={passengers.map((p) => ({ attendeeKey: p.attendeeKey, name: p.name, registrationNumber: p.registrationNumber, phone: p.phone, outbound: p.outbound, return: p.return }))}
        onSet={setBoarding}
      />
    </main>
  );
}
