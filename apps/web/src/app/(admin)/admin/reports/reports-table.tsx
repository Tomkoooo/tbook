"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChartColumn, Store, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef, type DataTableQuery, type TablePrefs } from "@/components/data-table";
import { formatDate } from "@/lib/format";
import { toneFor } from "@/lib/status-tones";

export interface ReportEventRow extends Record<string, unknown> {
  id: string;
  name: string;
  groupName: string;
  status: string;
  startDate: string;
  reportHref: string;
  attendeesHref: string | null;
  standHref: string | null;
}

const STATUS_TONES = { active: "success", draft: "neutral", archived: "neutral" } as const;

export const REPORT_COLUMNS: ColumnDef<ReportEventRow>[] = [
  { key: "name", label: "Event", sortable: true, searchable: true, hideable: false },
  { key: "groupName", label: "Group", sortable: true, searchable: true, type: "string" },
  { key: "startDate", label: "Date", type: "date", sortable: true, filterable: true, className: "whitespace-nowrap" },
  {
    key: "status",
    label: "Status",
    type: "enum",
    sortable: true,
    filterable: true,
    enumValues: [
      { value: "active", label: "Active" },
      { value: "draft", label: "Draft" },
      { value: "archived", label: "Archived" },
    ],
  },
  { key: "reports", label: "Reports", columnPickerLabel: "Report links", exportable: false, hideable: false },
];

/** One row per event, with the reports that exist for it. Search, filter and sort run in the page (client mode). */
export function ReportsTable({ rows, query, prefs }: { rows: ReportEventRow[]; query: DataTableQuery; prefs?: TablePrefs }) {
  const columns = useMemo(
    () =>
      REPORT_COLUMNS.map((column): ColumnDef<ReportEventRow> => {
        switch (column.key) {
          case "name":
            return { ...column, render: (_v, row) => <Link href={row.reportHref} className="font-medium hover:underline">{row.name}</Link> };
          case "startDate":
            return { ...column, render: (_v, row) => formatDate(row.startDate) };
          case "status":
            return { ...column, render: (_v, row) => <Badge variant={toneFor(STATUS_TONES, row.status)}>{row.status}</Badge> };
          case "reports":
            return {
              ...column,
              render: (_v, row) => (
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={row.reportHref}>
                      <ChartColumn /> Registrations
                    </Link>
                  </Button>
                  {row.attendeesHref ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={row.attendeesHref}>
                        <Users /> Attendees
                      </Link>
                    </Button>
                  ) : null}
                  {row.standHref ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={row.standHref}>
                        <Store /> Stand days
                      </Link>
                    </Button>
                  ) : null}
                </div>
              ),
            };
          default:
            return column;
        }
      }),
    [],
  );
  return <DataTable<ReportEventRow> tableId="reports" mode="client" columns={columns} data={rows} total={rows.length} query={query} basePath="/admin/reports" prefs={prefs} rowHref={(row) => row.reportHref} emptyMessage="No events yet." />;
}
