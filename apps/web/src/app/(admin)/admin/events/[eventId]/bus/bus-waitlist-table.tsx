import Link from "next/link";
import { busTransport } from "@tbook/modules";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { eventPath } from "@/lib/event-routes";

type Row = Awaited<ReturnType<typeof busTransport.listBusWaitlist>>[number];

/** The bus waitlist: demand per wanted route on top, then the line (optionally only the first `limit`). */
export function BusWaitlistTable({ eventId, waitlist, limit, showNotified = false }: { eventId: string; waitlist: Row[]; limit?: number; showNotified?: boolean }) {
  if (waitlist.length === 0) return <EmptyState title="Nobody is waiting for a bus" />;
  const demand = busTransport.busWaitlistDemand(waitlist);
  const rows = limit ? waitlist.slice(0, limit) : waitlist;
  return (
    <>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        {demand.routes.map((route) => (
          <Badge key={route.routeId} variant="secondary">
            {route.name} ({route.code}): {route.count}
          </Badge>
        ))}
        {demand.noRoute > 0 ? <Badge variant="outline">No route chosen: {demand.noRoute}</Badge> : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">#</TableHead>
            <TableHead>Guest</TableHead>
            <TableHead>Wants route</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Waiting since</TableHead>
            {showNotified ? <TableHead>Last notified</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.position}-${row.registrationNumber ?? row.name}`}>
              <TableCell className="text-right tabular-nums">{row.position}</TableCell>
              <TableCell>
                {row.name}
                <div className="text-muted-foreground text-xs">{row.registrationNumber ?? ""}</div>
              </TableCell>
              <TableCell>
                {row.routeId ? (
                  `${row.routeName} (${row.routeCode})`
                ) : (
                  <span className="text-muted-foreground">
                    not chosen{row.routeAskedAt ? ` · asked ${busTransport.formatDeparture(row.routeAskedAt)}` : ""}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {row.email || "—"}
                <div className="text-muted-foreground text-xs">{row.phone}</div>
              </TableCell>
              <TableCell>{busTransport.formatDeparture(row.joinedAt)}</TableCell>
              {showNotified ? <TableCell>{row.notifiedAt ? busTransport.formatDeparture(row.notifiedAt) : "—"}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {limit && waitlist.length > limit ? (
        <div className="text-muted-foreground px-4 py-3 text-sm">
          Showing {limit} of {waitlist.length}.{" "}
          <Link className="underline" href={eventPath(eventId, "bus")}>
            See the full list
          </Link>{" "}
          or export it.
        </div>
      ) : null}
    </>
  );
}
