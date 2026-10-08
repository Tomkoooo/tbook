import Link from "next/link";
import { Badge, Table } from "@tbook/ui";

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
    <div className="tbook-card-body-flush">
      <Table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Registration</th>
            <th>Capacity</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const team = event.registrationUnit === "team" || event.playersPerTicket > 1;
            const full = event.capacity != null && event.soldGuestCount >= event.capacity;
            return (
              <tr key={event.id}>
                <td className="tbook-wrap">{event.name}</td>
                <td>
                  {team ? (
                    <Badge tone="info">
                      team
                      {event.playersPerTicket > 1
                        ? ` · ${event.playersPerTicket} players`
                        : event.teamMemberLimit
                          ? ` · up to ${event.teamMemberLimit}`
                          : ""}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">individual</Badge>
                  )}
                </td>
                <td className="tbook-num">
                  {event.capacity == null ? "—" : `${event.soldGuestCount}/${event.capacity}`}
                </td>
                <td>
                  <Badge tone={event.status === "active" ? "success" : "neutral"}>{event.status}</Badge>
                  {full ? <Badge tone="warning">full</Badge> : null}
                </td>
                <td>
                  <Link
                    className="tbook-btn tbook-btn-secondary tbook-btn-sm"
                    href={`/admin/bookings/new?eventId=${event.id}`}
                  >
                    Select
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
