import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Step one. Deliberately lists closed-sales, archived and sold-out events
 * too — registering into exactly those is what this screen exists for, so
 * filtering them out would hide the main use case. Their state is labelled
 * instead.
 */
export function EventPicker({
  events,
}: {
  events: Array<{
    id: string;
    name: string;
    status: string;
    registrationUnit: string;
    playersPerTicket: number;
    teamMemberLimit: number | null;
    capacity: number | null;
    soldGuestCount: number;
  }>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Registration</TableHead>
          <TableHead className="text-right">Capacity</TableHead>
          <TableHead>State</TableHead>
          <TableHead>
            <span className="sr-only">Select</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => {
          const team = event.registrationUnit === "team" || event.playersPerTicket > 1;
          const full = event.capacity != null && event.soldGuestCount >= event.capacity;
          return (
            <TableRow key={event.id}>
              <TableCell className="font-medium whitespace-normal">{event.name}</TableCell>
              <TableCell>
                {team ? (
                  <Badge variant="info">
                    team
                    {event.playersPerTicket > 1
                      ? ` · ${event.playersPerTicket} players`
                      : event.teamMemberLimit
                        ? ` · up to ${event.teamMemberLimit}`
                        : ""}
                  </Badge>
                ) : (
                  <Badge variant="neutral">individual</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                {event.capacity == null ? "—" : `${event.soldGuestCount}/${event.capacity}`}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Badge variant={event.status === "active" ? "success" : "neutral"}>{event.status}</Badge>
                  {full ? <Badge variant="warning">full</Badge> : null}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/admin/bookings/new?eventId=${event.id}`}>Select</Link>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
