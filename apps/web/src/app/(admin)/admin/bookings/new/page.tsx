import Link from "next/link";
import { listRegistrableEvents, previewAdminRegistration } from "@tbook/services";
import { Card, EmptyState, Notice, PageHeader } from "@tbook/ui";
import { requireAdminPage } from "@/lib/admin-page";
import { RegistrationForm } from "./registration-form";
import { EventPicker } from "./event-picker";

/**
 * Manual registration. Two steps by design: pick the event first, because
 * the event decides whether the form asks for one person or a roster, and
 * what fields each needs. Rendering a generic form and then reshaping it
 * client-side would duplicate that logic in the browser.
 */
export const dynamic = "force-dynamic";

export default async function NewRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string; guests?: string }>;
}) {
  const { organizationId } = await requireAdminPage("booking:manage");
  const { eventId, guests: rawGuests } = await searchParams;

  const events = await listRegistrableEvents(organizationId);
  const selected = eventId ? events.find((event) => event.id === eventId) : undefined;
  const guests = Math.min(Math.max(Number(rawGuests ?? 1) || 1, 1), 50);

  if (events.length === 0) {
    return (
      <>
        <PageHeader breadcrumb={<Link href="/admin/bookings">← Bookings</Link>} title="New registration" />
        <Card>
          <EmptyState title="No events yet" hint="Create an event before registering anyone into it." />
        </Card>
      </>
    );
  }

  if (!selected) {
    return (
      <>
        <PageHeader
          breadcrumb={<Link href="/admin/bookings">← Bookings</Link>}
          title="New registration"
          description="Register someone who paid outside the storefront — by transfer, in cash, or as a comped entry."
        />
        <Card title="Which event?">
          <EventPicker events={events} />
        </Card>
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
      <PageHeader
        breadcrumb={<Link href="/admin/bookings/new">← Pick a different event</Link>}
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
        attendeeFields={preview.registrationFieldSchema}
        teamMemberFields={preview.teamMemberFieldSchema}
      />
    </>
  );
}
