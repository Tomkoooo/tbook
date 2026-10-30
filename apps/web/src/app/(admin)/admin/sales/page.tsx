import Link from "next/link";
import { ArrowLeft, Ticket } from "lucide-react";
import { ActionError } from "@tbook/actions";
import { getDayPassSaleOptions, listRegistrableEvents, previewAdminRegistration } from "@tbook/services";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/page-title";
import { formatDate, requireAdminPage } from "@/lib/admin-page";
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
  if (!permissions.has("sale:create") && !permissions.has("booking:manage")) {
    return <PageTitle title="Point of sale" description="You don't have permission to sell tickets." />;
  }

  const { eventId, tickets: rawTickets } = await searchParams;
  const events = (await listRegistrableEvents(organizationId)).filter((event) => event.status === "active");
  const tickets = Math.min(Math.max(Number(rawTickets ?? 1) || 1, 1), 50);
  const selected = eventId ? events.find((event) => event.id === eventId) : undefined;

  if (!selected) {
    return (
      <>
        <PageTitle title="Point of sale" description="Pick the event you're selling tickets for." />
        {events.length === 0 ? (
          <Alert>
            <AlertTitle>Nothing on sale</AlertTitle>
            <AlertDescription>There are no active events. Activate one under Events first.</AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {events.map((event) => {
              const left = event.capacity == null ? null : Math.max(event.capacity - event.soldGuestCount, 0);
              return (
                <Link key={event.id} href={`/admin/sales?eventId=${event.id}`} className="group">
                  <Card className="group-hover:border-primary h-full transition-colors">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Ticket className="size-4" /> {event.name}
                      </CardTitle>
                      <CardDescription>{event.startDate ? formatDate(event.startDate) : "No date"}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {left === null ? (
                        <Badge variant="secondary">No limit</Badge>
                      ) : left === 0 ? (
                        <Badge variant="destructive">Sold out</Badge>
                      ) : (
                        <Badge variant="secondary">{left} left</Badge>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
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
        description="Take payment, enter the customer, and the ticket and invoice are emailed straight away."
        actions={
          <Link className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline" href="/admin/sales">
            <ArrowLeft className="size-4" /> Other event
          </Link>
        }
      />
      {blocked || !preview ? (
        <Alert variant="destructive">
          <AlertTitle>This event can&apos;t be sold right now</AlertTitle>
          <AlertDescription>{blocked}</AlertDescription>
        </Alert>
      ) : (
        <SaleForm
          event={{
            id: selected.id,
            teamMemberLimit: selected.teamMemberLimit,
            playersPerTicket: selected.playersPerTicket,
          }}
          tickets={tickets}
          dayOptions={dayOptions?.days ?? null}
          currency={preview.event.currency}
          total={preview.quote.totalHuf}
          attendeeFields={preview.registrationFieldSchema}
          teamMemberFields={preview.teamMemberFieldSchema}
        />
      )}
    </>
  );
}
