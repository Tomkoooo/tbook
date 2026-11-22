import Link from "next/link";
import { ActionError } from "@tbook/actions";
import { POINT_OF_SALE } from "@tbook/modules";
import { getDayPassSaleOptions, listSellableReaders, previewAdminRegistration } from "@tbook/services";
import { Shirt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { requireEvent, requireEventModule } from "@/lib/require-module";
import { SaleForm } from "./sale-form";

export const dynamic = "force-dynamic";

/**
 * Seller point-of-sale for the event in the path (the station picker at
 * /admin/sales chooses it). The event decides whether the sale needs a
 * roster, so — as in the console registration form — the server renders the
 * right shape rather than the browser reshaping a generic one.
 */
export default async function SalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ tickets?: string }>;
}) {
  const { organizationId, permissions } = await requireAdminPage();
  const { eventId } = await params;
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, POINT_OF_SALE, "Point of sale");
  if (off) return off;
  if (!hasPermissionOrFallback(permissions, "sale:create") && !hasPermissionOrFallback(permissions, "booking:manage")) {
    return (
      <>
        <PageTitle title="Point of sale" description="You don't have permission to sell tickets." />
        <Notice tone="warning">Ask an organization admin for the sale:create permission.</Notice>
      </>
    );
  }

  const { tickets: rawTickets } = await searchParams;
  const readers = await listSellableReaders(organizationId);
  const tickets = Math.min(Math.max(Number(rawTickets ?? 1) || 1, 1), 50);
  const selected = {
    id: String(event._id),
    name: event.name,
    kind: event.kind ?? "standard",
    teamMemberLimit: event.teamMemberLimit ?? null,
    playersPerTicket: event.playersPerTicket ?? 1,
  };

  if (event.status !== "active") {
    return (
      <>
        <PageTitle title="Point of sale" description="Take payment, then either email the ticket and invoice, or print a receipt for a walk-in." />
        <Notice tone="warning" title="Nothing on sale">
          This event is {event.status}. Activate it to sell tickets here.
        </Notice>
      </>
    );
  }

  // No overrides here: if sales are closed or the event is full the seller
  // sees why, instead of being offered a form that can only fail.
  let preview;
  let blocked: string | null = null;
  let dayOptions: Awaited<ReturnType<typeof getDayPassSaleOptions>> = null;
  try {
    if (selected.kind === "day_pass") {
      dayOptions = await getDayPassSaleOptions(organizationId, selected.id);
      const firstDay = dayOptions?.days.find((day) => day.bookable);
      if (!firstDay) throw ActionError.validation("There are no days left to sell passes for.");
      // One pass on the first sellable day, just to read the attendee form
      // the event asks for; the real price is computed server-side on submit.
      preview = await previewAdminRegistration(organizationId, {
        eventId: selected.id,
        guests: 1,
        selections: { dayPasses: { [firstDay.date]: 1 } },
        overrides: {},
      });
    } else {
      preview = await previewAdminRegistration(organizationId, { eventId: selected.id, guests: tickets, overrides: {} });
    }
  } catch (error) {
    if (!(error instanceof ActionError)) throw error;
    blocked = error.message;
  }

  return (
    <>
      <PageTitle
        title="Point of sale"
        description="Take payment, then either email the ticket and invoice, or print a receipt for a walk-in."
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/merch">
              <Shirt /> Merch register
            </Link>
          </Button>
        }
      />
      {blocked || !preview ? (
        <Notice tone="danger" title="This event can't be sold right now">
          {blocked}
        </Notice>
      ) : (
        <SaleForm
          event={{
            id: selected.id,
            teamMemberLimit: selected.teamMemberLimit,
            playersPerTicket: selected.playersPerTicket,
          }}
          readers={readers.map((reader) => ({ id: reader.id, name: reader.name }))}
          tickets={tickets}
          dayOptions={dayOptions?.days ?? null}
          discountCodes={dayOptions?.discountCodes ?? []}
          currency={preview.event.currency}
          total={preview.quote.totalHuf}
          attendeeFields={preview.registrationFieldSchema}
          teamMemberFields={preview.teamMemberFieldSchema}
        />
      )}
    </>
  );
}
