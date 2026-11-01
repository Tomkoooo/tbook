import Link from "next/link";
import { DoorOpen } from "lucide-react";
import { listBookingFilterOptions } from "@tbook/services";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";

/**
 * Event picker for the door. Deliberately a separate step from the roster:
 * scanning is always scoped to one event so a ticket for the wrong day
 * reports "wrong event" rather than being admitted.
 */
export const dynamic = "force-dynamic";

export default async function CheckInIndexPage() {
  const { organizationId } = await requireAdminPage("voucher:read");
  const { events } = await listBookingFilterOptions(organizationId);

  return (
    <>
      <PageTitle title="Check-in" description="Pick the event you're working the door for." />

      <SectionCard flush>
        {events.length === 0 ? (
          <EmptyState title="No events yet" hint="Create an event first — entries are issued per event." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="font-medium whitespace-normal">{event.name}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/admin/check-in/${event.id}`}>
                        <DoorOpen /> Open door
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
