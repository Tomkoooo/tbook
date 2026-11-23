"use client";

import Link from "next/link";
import { useMemo } from "react";
import { WALK_IN_CUSTOMER_EMAIL } from "@tbook/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef, type DataTableQuery, type RowIssue, type TablePrefs } from "@/components/data-table";
import { formatDateTime, formatMoney } from "@/lib/format";
import { BOOKING_STATUS_TONES, INVOICE_STATUS_TONES, toneFor } from "@/lib/status-tones";
import type { BookingRow } from "./list-columns";

/** The bookings list: the shared engine plus this list's cell renderers (render functions can't cross from the server page). */
export function BookingsTable({
  rows,
  columns,
  query,
  total,
  basePath,
  prefs,
  exportHref,
  toolbarLeading,
}: {
  rows: BookingRow[];
  columns: ColumnDef<BookingRow>[];
  query: DataTableQuery;
  total: number;
  basePath: string;
  prefs?: TablePrefs;
  exportHref?: string;
  toolbarLeading?: React.ReactNode;
}) {
  const withCells = useMemo(
    () =>
      columns.map((column): ColumnDef<BookingRow> => {
        switch (column.key) {
          case "createdAt":
            return { ...column, render: (value) => formatDateTime(String(value)), exportValue: (row) => row.createdAt };
          case "customerName":
            return {
              ...column,
              render: (_value, row) => (
                <div className="min-w-0">
                  <Link className="font-medium hover:underline" href={`/admin/bookings/${row.id}`}>
                    {row.customerName}
                  </Link>
                  <div className="text-muted-foreground truncate text-xs">{row.customerEmail === WALK_IN_CUSTOMER_EMAIL ? "walk-in · printed receipt" : row.customerEmail}</div>
                </div>
              ),
              exportValue: (row) => `${row.customerName} <${row.customerEmail}>`,
            };
          case "eventName":
            return {
              ...column,
              render: (_value, row) => (
                <>
                  {row.eventName}
                  {row.hotelName ? <div className="text-muted-foreground text-xs">{row.hotelName}</div> : null}
                </>
              ),
            };
          case "groupName":
            return { ...column, render: (_value, row) => row.groupName || "–" };
          case "total":
            return { ...column, render: (_value, row) => formatMoney(row.total, row.currency), exportValue: (row) => `${row.total} ${row.currency}` };
          case "guests":
            return {
              ...column,
              render: (_value, row) => (
                <>
                  {row.guests}
                  {row.checkedIn !== null ? <div className="text-muted-foreground text-xs whitespace-nowrap">{row.checkedIn}/{row.guests} in</div> : null}
                </>
              ),
              exportValue: (row) => row.guests,
            };
          case "status":
            return {
              ...column,
              render: (_value, row) => (
                <div className="flex flex-wrap gap-1">
                  <Badge variant={toneFor(BOOKING_STATUS_TONES, row.status)}>{row.status}</Badge>
                  {row.source === "admin" ? <Badge variant="info">admin</Badge> : null}
                  {row.isTest ? <Badge variant="warning">TESZT</Badge> : null}
                </div>
              ),
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
          case "invoiceStatus":
            return {
              ...column,
              render: (_value, row) => (
                <div className="flex flex-wrap gap-1">
                  <Badge variant={toneFor(INVOICE_STATUS_TONES, row.invoiceStatus)}>{row.invoiceStatus}</Badge>
                  {row.invoiceSource === "manual" ? <Badge variant="neutral">manual</Badge> : null}
                </div>
              ),
            };
          case "open":
            return {
              ...column,
              render: (_value, row) => (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/admin/bookings/${row.id}`}>Open</Link>
                </Button>
              ),
            };
          default:
            return column;
        }
      }),
    [columns],
  );

  const issues = (row: BookingRow): RowIssue[] => (row.status === "cancelled" ? [{ tone: "danger", message: "Cancelled" }] : []);

  return (
    <DataTable<BookingRow>
      tableId="bookings"
      columns={withCells}
      data={rows}
      query={query}
      total={total}
      basePath={basePath}
      prefs={prefs}
      rowHref={(row) => `/admin/bookings/${row.id}`}
      rowIssues={issues}
      exportHref={exportHref}
      exportTitle="bookings"
      toolbarLeading={toolbarLeading}
      emptyMessage="No bookings match these filters."
    />
  );
}
