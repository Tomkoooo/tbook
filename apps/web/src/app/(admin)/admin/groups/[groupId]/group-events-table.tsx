import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { SectionCard } from "@/components/section-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";
import { toneFor } from "@/lib/status-tones";

export interface GroupEventRow {
  id: string;
  name: string;
  startDate: Date | string | null | undefined;
  status: string;
  /** Labels of the tools switched on for that event. */
  tools: string[];
}

const STATUS_TONES = { active: "success", draft: "neutral", archived: "neutral" } as const;

/** The events of one group, each linking into its workspace, with the tools that are on. */
export function GroupEventsTable({ rows, title = "Events in this group", description = "Open an event for its guests, buses, emails and the rest of its tools." }: { rows: GroupEventRow[]; title?: string; description?: string }) {
  return (
    <SectionCard title={title} description={description} flush>
      {rows.length === 0 ? (
        <EmptyState title="No events in this group yet" hint="Create an event and choose this group." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Starts</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tools switched on</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link className="font-medium hover:underline" href={eventPath(row.id)}>
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">{formatDate(row.startDate)}</TableCell>
                <TableCell>
                  <Badge variant={toneFor(STATUS_TONES, row.status)}>{row.status}</Badge>
                </TableCell>
                <TableCell>
                  {row.tools.length === 0 ? (
                    <span className="text-muted-foreground text-sm">None</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {row.tools.map((label) => (
                        <Badge key={label} variant="outline">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
