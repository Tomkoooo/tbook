import Link from "next/link";
import { ListOrdered } from "lucide-react";
import { WAITLIST, waitlist } from "@tbook/modules";
import { listEventsForOrg, resolveModules } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { EventPicker } from "@/components/event-picker";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { Stat } from "@/components/stat";
import { formatDateTime, requireAdminPage } from "@/lib/admin-page";
import { ProcessWaitlistButton, RemoveEntryButton } from "./waitlist-controls";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  waiting: { label: "Waiting", variant: "outline" },
  offered: { label: "Offered", variant: "default" },
  registered: { label: "Registered", variant: "secondary" },
  expired: { label: "Offer expired", variant: "outline" },
  declined: { label: "Declined", variant: "outline" },
  failed: { label: "Couldn't register", variant: "destructive" },
  removed: { label: "Removed", variant: "outline" },
};

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const { eventId: requested } = await searchParams;
  const { organizationId } = await requireAdminPage("waitlist:manage");

  const events = [];
  for (const event of await listEventsForOrg(organizationId)) {
    if ((await resolveModules({ organizationId, event })).isOn(WAITLIST)) events.push(event);
  }
  const event = events.find((e) => String(e._id) === requested) ?? events[0] ?? null;
  if (!event) {
    return (
      <>
        <PageTitle title="Waitlist" />
        <SectionCard>
          <EmptyState icon={<ListOrdered />} title="No event uses a waitlist" hint="Switch on “Waitlist” in an event's Modules section." />
        </SectionCard>
      </>
    );
  }

  const eventId = String(event._id);
  const { rows, mode, hours, free } = await waitlist.listWaitlist(organizationId, eventId);
  const count = (status: string) => rows.filter((row) => row.status === status).length;

  return (
    <>
      <PageTitle
        title="Waitlist"
        description={
          mode === "auto"
            ? "A freed place goes to the first in line automatically."
            : `A freed place is offered to the first in line by email and held for ${hours} hours.`
        }
        actions={
          <>
            {events.length > 1 ? <EventPicker basePath="/admin/waitlist" events={events.map((e) => ({ id: String(e._id), name: e.name }))} value={eventId} /> : null}
            <ProcessWaitlistButton eventId={eventId} />
          </>
        }
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Waiting" value={count("waiting")} />
        <Stat label="Open offers" value={count("offered")} />
        <Stat label="Registered from waitlist" value={count("registered")} />
        <Stat label="Free places" value={free == null ? "∞" : free} />
      </div>
      <SectionCard title={event.name} flush>
        {rows.length === 0 ? (
          <EmptyState title="Nobody is waiting" hint="When the event is full, the website can offer the waitlist (API: POST /api/v1/waitlist/join)." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Guests</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="tabular-nums">{row.position ?? "—"}</TableCell>
                  <TableCell>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-muted-foreground text-xs">{[row.email, row.phone].filter(Boolean).join(" · ")}</div>
                    {row.lastError ? <div className="text-destructive text-xs">{row.lastError}</div> : null}
                  </TableCell>
                  <TableCell className="tabular-nums">{row.guests}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS[row.status]?.variant ?? "outline"}>{STATUS[row.status]?.label ?? row.status}</Badge>
                    {row.status === "offered" && row.offerExpiresAt ? (
                      <div className="text-muted-foreground text-xs">until {formatDateTime(row.offerExpiresAt)}</div>
                    ) : null}
                    {row.bookingId ? (
                      <div className="text-xs">
                        <Link className="underline" href={`/admin/bookings/${row.bookingId}`}>
                          Booking
                        </Link>
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                  <TableCell>{row.status === "waiting" || row.status === "offered" ? <RemoveEntryButton entryId={row.id} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
