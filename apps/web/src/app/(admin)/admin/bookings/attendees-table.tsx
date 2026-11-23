"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef, type DataTableQuery, type TablePrefs } from "@/components/data-table";
import { choiceTone } from "@/lib/answer-tone";
import { formatDateTime } from "@/lib/format";
import { ANSWER_PREFIX, type AttendeeTableRow } from "./list-columns";

/** The attendees list: one row per guest, the registration answers as columns. */
export function AttendeesTable({
  rows,
  columns,
  query,
  total,
  basePath,
  prefs,
  exportHref,
  toolbarLeading,
}: {
  rows: AttendeeTableRow[];
  columns: ColumnDef<AttendeeTableRow>[];
  query: DataTableQuery;
  total: number;
  basePath: string;
  prefs?: TablePrefs;
  exportHref?: string;
  toolbarLeading?: React.ReactNode;
}) {
  const withCells = useMemo(
    () =>
      columns.map((column): ColumnDef<AttendeeTableRow> => {
        switch (column.key) {
          case "name":
            return {
              ...column,
              render: (_value, row) => (
                <Link className="font-medium hover:underline" href={`/admin/bookings/${row.bookingId}`}>
                  {row.name}
                </Link>
              ),
            };
          case "status":
            return {
              ...column,
              render: (_value, row) =>
                row.status === "checked_in" ? (
                  <Badge variant="success" title={row.checkedInAt ? formatDateTime(row.checkedInAt) : undefined}>
                    <Check /> {row.checkedInAt ? formatDateTime(row.checkedInAt) : "In"}
                  </Badge>
                ) : (
                  <Badge variant="neutral">Expected</Badge>
                ),
              exportValue: (row) => (row.status === "checked_in" ? `Checked in ${row.checkedInAt ?? ""}`.trim() : "Expected"),
            };
          case "tags":
            return {
              ...column,
              render: (_value, row) =>
                row.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {row.tags.map((tag) => (
                      <Badge key={tag} variant="note">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">–</span>
                ),
              exportValue: (row) => row.tags.join(", "),
            };
          case "open":
            return {
              ...column,
              render: (_value, row) => (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/admin/bookings/${row.bookingId}`}>Booking</Link>
                </Button>
              ),
            };
          default:
            // A choice question: the answer as a badge, coloured by which choice it is (same colour for the same answer everywhere).
            if (column.key.startsWith(ANSWER_PREFIX) && column.type === "enum" && column.enumValues) {
              const choices = column.enumValues;
              return {
                ...column,
                render: (value) => {
                  const text = String(value ?? "");
                  if (!text) return <span className="text-muted-foreground">–</span>;
                  const index = choices.findIndex((choice) => choice.label === text);
                  const checkbox = choices.length === 2 && choices[0]?.value === "yes";
                  return (
                    <Badge variant={checkbox ? (text === choices[0]!.label ? "success" : "neutral") : choiceTone(index, text)} className="h-auto max-w-56 whitespace-normal text-left">
                      {text}
                    </Badge>
                  );
                },
              };
            }
            return column;
        }
      }),
    [columns],
  );

  return (
    <DataTable<AttendeeTableRow>
      tableId="attendees"
      columns={withCells}
      data={rows}
      query={query}
      total={total}
      basePath={basePath}
      prefs={prefs}
      rowHref={(row) => `/admin/bookings/${row.bookingId}`}
      exportHref={exportHref}
      exportTitle="attendees"
      toolbarLeading={toolbarLeading}
      emptyMessage="No guests match these filters."
    />
  );
}
