import Link from "next/link";
import { listBookingFilterOptions } from "@tbook/services";
import { Card, EmptyState, PageHeader, Table } from "@tbook/ui";
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
      <PageHeader title="Check-in" description="Pick the event you're working the door for." />

      <Card>
        <div className="tbook-card-body-flush">
          {events.length === 0 ? (
            <EmptyState title="No events yet" hint="Create an event first — entries are issued per event." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.name}</td>
                    <td>
                      <Link className="tbook-btn tbook-btn-secondary tbook-btn-sm" href={`/admin/check-in/${event.id}`}>
                        Open door
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>
    </>
  );
}
