import Link from "next/link";
import { CalendarX, ChevronRight, Ticket } from "lucide-react";
import { ActionError } from "@tbook/actions";
import { POINT_OF_SALE } from "@tbook/modules";
import { getDayPassSaleOptions, listRegistrableEvents, listSellableReaders, previewAdminRegistration } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { SalesTabs } from "./sales-tabs";
import { formatDate, requireAdminPage } from "@/lib/admin-page";
import { requireModule } from "@/lib/require-module";
import { SaleForm } from "./sale-form";

export const dynamic = "force-dynamic";

/**
 * Seller point-of-sale. Step one picks the event from what is actually on
 * sale; step two is a single form. The event decides whether the sale needs
 * a roster, so — as in the console registration form — the server renders
 * the right shape rather than the browser reshaping a generic one.
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string; tickets?: string }>;
}) {
  const { organizationId, permissions } = await requireAdminPage();
  const off = await requireModule(organizationId, POINT_OF_SALE, "Point of sale");
  if (off) return off;
  if (!permissions.has("sale:create") && !permissions.has("booking:manage")) {
    return (
      <>
        <PageTitle title="Point of sale" description="You don't have permission to sell tickets." />
        <Notice tone="warning">Ask an organization admin for the sale:create permission.</Notice>
      </>
    );
  }

  const { eventId, tickets: rawTickets } = await searchParams;
  const readers = await listSellableReaders(organizationId);
  const events = (await listRegistrableEvents(organizationId)).filter((event) => event.status === "active");
  const tickets = Math.min(Math.max(Number(rawTickets ?? 1) || 1, 1), 50);
  const selected = eventId ? events.find((event) => event.id === eventId) : undefined;

  if (!selected) {
    return (
      <>
        <PageTitle title="Point of sale" description="Pick the event you're selling tickets for." />
        <SalesTabs active="tickets" />
        {events.length === 0 ? (
          <EmptyState
            variant="hero"
            icon={<CalendarX />}
            title="Nothing on sale"
            hint="There are no active events. Activate one under Events first."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 md:gap-4 xl:grid-cols-3">
            {events.map((event) => {
              const left = event.capacity == null ? null : Math.max(event.capacity - event.soldGuestCount, 0);
              const scarce = left !== null && event.capacity ? left / event.capacity <= 0.1 : false;
              return (
                <li key={event.id}>
                  <Link
                    href={`/admin/sales?eventId=${event.id}`}
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
        title={selected.name}
        description="Take payment, then either email the ticket and invoice, or print a receipt for a walk-in."
        back={{ href: "/admin/sales", label: "Other event" }}
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
