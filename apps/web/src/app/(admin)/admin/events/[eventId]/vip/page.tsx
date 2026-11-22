import { Star } from "lucide-react";
import { vipRoster } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";
import { requireEvent } from "@/lib/require-module";

export const dynamic = "force-dynamic";

const dateTime = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", dateStyle: "short", timeStyle: "short" });

export default async function VipPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { organizationId } = await requireAdminPage("booking:read");
  const { eventId } = await params;
  const event = await requireEvent(organizationId, eventId);
  const back = { href: eventPath(eventId), label: event.name };

  if (!event.vipListId) {
    return (
      <>
        <PageTitle title="VIP guests" back={back} />
        <SectionCard>
          <EmptyState icon={<Star />} title="This event has no VIP list" hint="Set the event's VIP list (a name list in Data) to let VIPs register by name from their own seat pool." />
        </SectionCard>
      </>
    );
  }

  const roster = await vipRoster(eventId);
  return (
    <>
      <PageTitle title="VIP guests" description="The VIP name list and who from it has registered. VIPs use their own seats and are tagged VIP on the scan." back={back} />
      <SectionCard
        title={event.name}
        description={`${roster?.registered ?? 0} of ${roster?.total ?? 0} VIPs registered · VIP seats ${event.vipSoldCount ?? 0}${event.vipCapacity == null ? "" : ` / ${event.vipCapacity}`}`}
        flush
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Registration</TableHead>
              <TableHead>Registered at</TableHead>
              <TableHead>Contact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(roster?.rows ?? []).map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.registered ? <Badge variant="success">Registered</Badge> : <Badge variant="outline">Not yet</Badge>}</TableCell>
                <TableCell className="tabular-nums">{row.registrationNumber ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{row.registeredAt ? dateTime.format(row.registeredAt) : "—"}</TableCell>
                <TableCell>{row.email ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </>
  );
}
