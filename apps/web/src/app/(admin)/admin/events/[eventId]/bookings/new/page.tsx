import Link from "next/link";
import { TICKET_SALES } from "@tbook/modules";
import { listRegistrableEvents, liveFieldSchemaForEvent, previewAdminRegistration } from "@tbook/services";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";
import { requireEvent, requireEventModule } from "@/lib/require-module";
import { RegistrationForm } from "./registration-form";

/**
 * Manual registration into the event in the path. The event decides whether
 * the form asks for one person or a roster, and what fields each needs, so
 * the server renders the right shape (rather than a generic form reshaped
 * client-side, which would duplicate that logic in the browser).
 */
export const dynamic = "force-dynamic";

export default async function NewRegistrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ guests?: string }>;
}) {
  const { organizationId } = await requireAdminPage("booking:manage");
  const { eventId } = await params;
  const { guests: rawGuests } = await searchParams;
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, TICKET_SALES, "Ticket selling");
  if (off) return off;

  const breadcrumbs = [{ label: "Bookings", href: eventPath(eventId, "bookings") }];
  const selected = (await listRegistrableEvents(organizationId)).find((candidate) => candidate.id === eventId);
  const guests = Math.min(Math.max(Number(rawGuests ?? 1) || 1, 1), 50);

  if (!selected) {
    return (
      <>
        <PageTitle breadcrumbs={breadcrumbs} title="New registration" />
        <SectionCard>
          <EmptyState title="This event can't take registrations" hint="It isn't part of an event group, so it can't be registered into by hand." />
        </SectionCard>
      </>
    );
  }

  if (selected.kind === "day_pass") {
    return (
      <>
        <PageTitle breadcrumbs={breadcrumbs} title={selected.name} />
        <SectionCard>
          <EmptyState
            title="This is a day-pass event"
            hint="Passes are sold per day. Use the Point of sale screen to choose the days and take payment."
          />
          <div className="flex justify-center pb-2">
            <Button asChild>
              <Link href={eventPath(selected.id, "sales")}>Open point of sale</Link>
            </Button>
          </div>
        </SectionCard>
      </>
    );
  }

  // The event's own schema drives the form, so a team event asks for a
  // roster and a person event doesn't — one code path, no client branching.
  const preview = await previewAdminRegistration(organizationId, {
    eventId: selected.id,
    guests,
    overrides: { allowClosedSales: true, allowInactiveEvent: true },
  });

  const isTeam = preview.teamMemberFieldSchema.length > 0;
  const rosterSize = selected.playersPerTicket > 1 ? selected.playersPerTicket : null;
  const soldOut = selected.capacity != null && selected.soldGuestCount + guests > selected.capacity;

  return (
    <>
      <PageTitle
        breadcrumbs={breadcrumbs}
        title={selected.name}
        description={
          isTeam
            ? `Team registration — ${rosterSize ? `${rosterSize} players per entry` : `up to ${selected.teamMemberLimit ?? "?"} players per entry`}`
            : "Individual registration"
        }
      />

      {selected.status !== "active" ? (
        <Notice tone="warning">
          This event is <strong>{selected.status}</strong>. Tick &ldquo;allow inactive event&rdquo; below to register into it
          anyway.
        </Notice>
      ) : null}

      {soldOut ? (
        <Notice tone="warning">
          This event is at capacity ({selected.soldGuestCount}/{selected.capacity}). Tick &ldquo;allow over capacity&rdquo;
          below to register anyway.
        </Notice>
      ) : null}

      <RegistrationForm
        event={{
          id: selected.id,
          name: selected.name,
          status: selected.status,
          capacity: selected.capacity,
          soldGuestCount: selected.soldGuestCount,
          teamMemberLimit: selected.teamMemberLimit,
          playersPerTicket: selected.playersPerTicket,
        }}
        guests={guests}
        currency={preview.event.currency}
        totalHuf={preview.quote.totalHuf}
        attendeeFields={JSON.parse(JSON.stringify(await liveFieldSchemaForEvent(selected.id, preview.registrationFieldSchema)))}
        teamMemberFields={preview.teamMemberFieldSchema}
      />
    </>
  );
}
