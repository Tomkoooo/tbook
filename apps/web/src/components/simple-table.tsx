import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ariaSort, nextSortDir, type SortDir, type SortState } from "@/lib/table-sort";
import { cn } from "@/lib/utils";

/**
 * SimpleTable — a small, server-renderable table over the shadcn Table.
 * It is deliberately not an engine: no client state, no column picker. Pages
 * keep their own filters/paging in the URL and hand it rows and columns.
 *
 *   <SimpleTable
 *     rows={bookings}
 *     rowKey={(b) => String(b._id)}
 *     columns={[
 *       { key: "when", header: "Booked", sortKey: "createdAt", cell: (b) => formatDateTime(b.createdAt) },
 *       { key: "total", header: "Total", align: "right", cell: (b) => formatMoney(b.total, b.currency) },
 *       { key: "open", header: <span className="sr-only">Open</span>, mobile: "footer", cell: … },
 *     ]}
 *     sort={{ state: { key: "createdAt", dir: "desc" }, hrefFor: (key, dir) => hrefWith({ sortBy: key, sortDir: dir }) }}
 *     mobileCards
 *     empty={<EmptyState title="No bookings" />}
 *   />
 *
 * Props:
 *   columns     SimpleColumn<T>[]  (see below)
 *   rows        T[]
 *   rowKey      (row) => string
 *   sort        { state, hrefFor } — turns columns that have `sortKey` into links;
 *               `hrefFor(key, dir)` builds the next URL (see lib/table-sort.ts)
 *   density     "compact" (36px rows, default) | "comfortable" (44px) | "touch" (56px)
 *   maxHeight   "sm" | "md" | "lg" — scroll the body inside the card and keep the header
 *               sticky. Omit for a plain table that only scrolls sideways.
 *   mobileCards render each row as a card below `md` instead of a sideways-scrolling table
 *   empty       shown instead of the table when `rows` is empty
 *   rowClassName (row) => string | undefined  (e.g. dim an inactive row)
 *   caption     visually hidden table caption, for screen readers
 *   className   extra classes on the <table>
 *
 * SimpleColumn: key, header, cell(row), align ("left" | "right" | "center"),
 *   sortKey, hideBelow ("sm" | "md" | "lg" | "xl": hide the column on narrower screens),
 *   wrap (allow the cell text to wrap), className, mobile ("title" | "footer" | "hide";
 *   default: shown as a label/value row), mobileLabel (label when `header` is not a string).
 *
 * Server component. Keep it that way: it takes function props (`cell`, `rowKey`),
 * which may not cross from a server page into a client component.
 */
export interface SimpleColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  sortKey?: string;
  hideBelow?: "sm" | "md" | "lg" | "xl";
  wrap?: boolean;
  className?: string;
  mobile?: "title" | "footer" | "hide";
  mobileLabel?: string;
}

export interface SimpleTableSort {
  state: SortState;
  hrefFor: (key: string, dir: SortDir) => string;
}

const HIDE_BELOW = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;

const ALIGN = { left: "", right: "text-right", center: "text-center" } as const;

const ROW_HEIGHT = {
  compact: "[&>td]:h-(--row-h-compact) [&>td]:py-1.5",
  comfortable: "[&>td]:h-(--row-h-comfortable)",
  touch: "[&>td]:h-(--row-h-touch)",
} as const;

const MAX_HEIGHT = { sm: "max-h-80", md: "max-h-[28rem]", lg: "max-h-[40rem]" } as const;

export function SimpleTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  density = "compact",
  maxHeight,
  mobileCards,
  empty,
  rowClassName,
  caption,
  className,
}: {
  columns: SimpleColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  sort?: SimpleTableSort;
  density?: keyof typeof ROW_HEIGHT;
  maxHeight?: keyof typeof MAX_HEIGHT;
  mobileCards?: boolean;
  empty?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  caption?: string;
  className?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  const table = (
    <Table
      className={cn("text-[13px] md:text-sm", className)}
      containerClassName={maxHeight ? cn("overflow-auto", MAX_HEIGHT[maxHeight]) : undefined}
    >
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              key={column.key}
              aria-sort={sort && column.sortKey ? ariaSort(sort.state, column.sortKey) : undefined}
              className={cn(
                ALIGN[column.align ?? "left"],
                column.hideBelow && HIDE_BELOW[column.hideBelow],
                maxHeight && "bg-muted sticky top-0 z-10",
              )}
            >
              {sort && column.sortKey ? <SortLink column={column} sort={sort} /> : column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)} className={cn(ROW_HEIGHT[density], rowClassName?.(row))}>
            {columns.map((column) => (
              <TableCell
                key={column.key}
                className={cn(
                  ALIGN[column.align ?? "left"],
                  column.hideBelow && HIDE_BELOW[column.hideBelow],
                  column.wrap && "whitespace-normal",
                  column.className,
                )}
              >
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  if (!mobileCards) return table;

  const titleColumns = columns.filter((column) => column.mobile === "title");
  const footerColumns = columns.filter((column) => column.mobile === "footer");
  const valueColumns = columns.filter((column) => !column.mobile);
  // With no explicit title column, the first column leads the card.
  const leading = titleColumns.length > 0 ? titleColumns : valueColumns.slice(0, 1);
  const body = titleColumns.length > 0 ? valueColumns : valueColumns.slice(1);

  return (
    <>
      <ul className="divide-border divide-y md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className={cn("grid gap-2 px-4 py-3", rowClassName?.(row))}>
            {leading.map((column) => (
              <div key={column.key} className="min-w-0 text-sm font-medium break-words">
                {column.cell(row)}
              </div>
            ))}
            {body.length > 0 ? (
              <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-sm">
                {body.map((column) => {
                  const label = typeof column.header === "string" ? column.header : column.mobileLabel;
                  return (
                    <div key={column.key} className="col-span-2 grid grid-cols-subgrid items-baseline">
                      <dt className="text-muted-foreground text-xs">{label}</dt>
                      <dd className="num min-w-0 text-right break-words">{column.cell(row)}</dd>
                    </div>
                  );
                })}
              </dl>
            ) : null}
            {footerColumns.length > 0 ? (
              <div className="flex flex-wrap justify-end gap-2">
                {footerColumns.map((column) => (
                  <div key={column.key}>{column.cell(row)}</div>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="hidden md:block">{table}</div>
    </>
  );
}

function SortLink<T>({ column, sort }: { column: SimpleColumn<T>; sort: SimpleTableSort }) {
  const key = column.sortKey as string;
  const active = sort.state.key === key;
  const Icon = !active ? ArrowUpDown : sort.state.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link
      className={cn(
        "hover:text-foreground inline-flex items-center gap-1 transition-colors",
        active && "text-foreground",
        column.align === "right" && "flex-row-reverse",
      )}
      href={sort.hrefFor(key, nextSortDir(sort.state, key))}
    >
      {column.header}
      <Icon className={cn("size-3.5", !active && "opacity-40")} />
    </Link>
  );
}
