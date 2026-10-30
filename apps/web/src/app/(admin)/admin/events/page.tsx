import Link from "next/link";
import { Plus } from "lucide-react";
import { listEventsForOrg, listGroupsForOrg } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageTitle } from "@/components/page-title";
import { formatDate, formatMoney, requireAdminPage } from "@/lib/admin-page";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const { organizationId, permissions } = await requireAdminPage("event:read");
  const [events, groups] = await Promise.all([listEventsForOrg(organizationId), listGroupsForOrg(organizationId)]);
  const groupName = new Map(groups.map((group) => [String(group._id), group.name]));

  return (
    <>
      <PageTitle
        title="Events"
        description="Everything you sell tickets for."
        actions={
          permissions.has("event:write") ? (
            <Button asChild>
              <Link href="/admin/events/new">
                <Plus /> New event
              </Link>
            </Button>
          ) : null
        }
      />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Sold</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground h-24 text-center">
                  No events yet.
                </TableCell>
              </TableRow>
            ) : (
              events.map((event) => (
                <TableRow key={String(event._id)}>
                  <TableCell>
                    <Link className="font-medium hover:underline" href={`/admin/events/${event._id}`}>
                      {event.name}
                    </Link>
                  </TableCell>
                  <TableCell>{(event.groupId && groupName.get(String(event.groupId))) || "—"}</TableCell>
                  <TableCell>
                    {formatDate(event.startDate)}
                    {String(event.startDate) !== String(event.endDate) ? ` – ${formatDate(event.endDate)}` : ""}
                  </TableCell>
                  <TableCell>{formatMoney(event.ticketFeeHuf, event.currency)}</TableCell>
                  <TableCell>
                    {event.soldGuestCount}
                    {event.capacity != null ? ` / ${event.capacity}` : ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={event.status === "active" ? "default" : "secondary"}>{event.status}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
