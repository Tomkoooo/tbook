"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Filter, Search, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/form-bits";
import { cn } from "@/lib/utils";
import { activeFilterCount, applyClientQuery, parseSort, withParams } from "./query";
import { tablePrefsCookie } from "./prefs";
import { PAGE_SIZES, type ColumnDef, type DataTableQuery, type RowIssue, type TablePrefs } from "./types";

export interface DataTableProps<T extends Record<string, unknown>> {
  /** Stable and unique (`<module>-<list>`): the viewer's column/page-size choices hang on it. */
  tableId: string;
  columns: ColumnDef<T>[];
  data: T[];
  query: DataTableQuery;
  /** Server mode: all matching rows (the page holds only `data`). Client mode: ignored. */
  total: number;
  /** The list's own path — the URL the toolbar rewrites. */
  basePath: string;
  /** `server` (default): `data` is the current page. `client`: `data` is everything; search/filter/sort/page run here. */
  mode?: "server" | "client";
  /** The viewer's saved columns / page size (read from the cookie by the page, so the first paint is right). */
  prefs?: TablePrefs;
  rowKey?: (row: T) => string;
  rowHref?: (row: T) => string;
  rowIssues?: (row: T) => RowIssue[];
  toolbarLeading?: ReactNode;
  toolbarExtra?: ReactNode;
  /** Server mode: a link that downloads the whole filtered list (CSV). Client mode builds a CSV itself. */
  exportHref?: string;
  exportTitle?: string;
  emptyMessage?: ReactNode;
  variant?: "default" | "compact";
}

/**
 * The list engine. Search, filters, sort, columns and page size are one
 * toolbar; the state is the URL. Wrap it in a `"use client"` file in the
 * module (render functions can't be passed from a server page) and give it a
 * stable `tableId`.
 */
export function DataTable<T extends Record<string, unknown>>(props: DataTableProps<T>) {
  return (
    <Suspense fallback={<TableFallback />}>
      <DataTableRoot {...props} />
    </Suspense>
  );
}

function TableFallback() {
  return (
    <div className="bg-card grid gap-3 rounded-xl border p-4 shadow-xs" aria-busy>
      <Skeleton className="h-9 w-full max-w-sm" />
      {[0, 1, 2, 3, 4].map((row) => (
        <Skeleton key={row} className="h-9 w-full" />
      ))}
    </div>
  );
}

function orderedVisible<T>(columns: ColumnDef<T>[], prefs?: TablePrefs): string[] {
  const defaults = columns.filter((column) => column.defaultVisible !== false).map((column) => column.key);
  if (!prefs?.columns || prefs.columns.length === 0) return defaults;
  const known = new Set(columns.map((column) => column.key));
  const chosen = prefs.columns.filter((key) => known.has(key));
  // A column that can't be hidden is always there, whatever an old preference says.
  for (const column of columns) if (column.hideable === false && !chosen.includes(column.key)) chosen.unshift(column.key);
  return chosen.length > 0 ? chosen : defaults;
}

function saveCookie(tableId: string, prefs: TablePrefs) {
  try {
    document.cookie = `${tablePrefsCookie(tableId)}=${encodeURIComponent(JSON.stringify(prefs))}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Preferences are a convenience; a blocked cookie must not break the list.
  }
}

function optionLabel<T>(column: ColumnDef<T>, value: string): string {
  return column.enumValues?.find((option) => option.value === value)?.label ?? value;
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function DataTableRoot<T extends Record<string, unknown>>({
  tableId,
  columns,
  data,
  query,
  total,
  basePath,
  mode = "server",
  prefs,
  rowKey,
  rowHref,
  rowIssues,
  toolbarLeading,
  toolbarExtra,
  exportHref,
  exportTitle,
  emptyMessage,
  variant = "default",
}: DataTableProps<T>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [visible, setVisible] = useState<string[]>(() => orderedVisible(columns, prefs));
  const [panel, setPanel] = useState<"filters" | "sort" | "columns" | null>(null);
  const [searchText, setSearchText] = useState(query.search);
  const lastSearch = useRef(query.search);

  // The URL is the truth: a back/forward step or a "Clear" elsewhere resets the box.
  useEffect(() => {
    setSearchText(query.search);
    lastSearch.current = query.search;
  }, [query.search]);

  const shown = useMemo(() => {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    return visible.map((key) => byKey.get(key)).filter((column): column is ColumnDef<T> => Boolean(column));
  }, [columns, visible]);

  const clientResult = useMemo(() => (mode === "client" ? applyClientQuery(data, columns, query) : null), [mode, data, columns, query]);
  const rows = clientResult?.rows ?? data;
  const totalRows = clientResult?.total ?? total;
  const sort = parseSort(query.sort, columns);
  const filterCount = activeFilterCount(query);
  const pageCount = Math.max(Math.ceil(totalRows / query.pageSize), 1);
  const page = Math.min(query.page, pageCount);

  const push = (changes: Record<string, string | string[] | undefined>) => {
    const qs = withParams(new URLSearchParams(searchParams.toString()), { page: undefined, ...changes });
    startTransition(() => router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false }));
  };

  // Debounced search: typing waits 350 ms; Enter goes now.
  useEffect(() => {
    if (searchText === lastSearch.current) return;
    const handle = setTimeout(() => {
      lastSearch.current = searchText;
      push({ search: searchText.trim() || undefined });
    }, 350);
    return () => clearTimeout(handle);
  }, [searchText]);

  const setColumns = (next: string[]) => {
    setVisible(next);
    saveCookie(tableId, { columns: next, pageSize: query.pageSize });
  };

  const changeSort = (key: string) => {
    const current = sort?.key === key ? sort.dir : null;
    push({ sort: current === null ? key : current === "asc" ? `-${key}` : undefined });
  };

  const changePageSize = (size: number) => {
    saveCookie(tableId, { columns: visible, pageSize: size });
    push({ pageSize: String(size) });
  };

  const exportable = shown.filter((column) => column.exportable !== false && column.label !== "");
  const exportCsv = () => {
    const all = mode === "client" ? applyClientQuery(data, columns, { ...query, page: 1, pageSize: Number.MAX_SAFE_INTEGER }).rows : rows;
    const header = exportable.map((column) => csvEscape(column.label)).join(",");
    const lines = all.map((row) =>
      exportable
        .map((column) => {
          const custom = column.exportValue?.(row);
          if (custom !== undefined) return csvEscape(custom);
          const raw = row[column.key];
          return csvEscape(Array.isArray(raw) ? raw.join(", ") : column.enumValues && typeof raw === "string" ? optionLabel(column, raw) : raw);
        })
        .join(","),
    );
    const blob = new Blob([String.fromCharCode(0xfeff), [header, ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(exportTitle ?? tableId).replace(/[^\w-]+/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const keyOf = (row: T, index: number) => (rowKey ? rowKey(row) : String(row._id ?? row.id ?? index));
  const compact = variant === "compact";
  const first = totalRows === 0 ? 0 : (page - 1) * query.pageSize + 1;
  const last = Math.min(page * query.pageSize, totalRows);
  const colSpan = Math.max(shown.length, 1);

  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-xs" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {toolbarLeading ? <div className="contents">{toolbarLeading}</div> : null}
        {columns.some((column) => column.searchable) ? (
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  lastSearch.current = searchText;
                  push({ search: searchText.trim() || undefined });
                }
              }}
              placeholder="Search…"
              aria-label="Search"
              className="pl-8"
            />
          </div>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {columns.some((column) => column.filterable) ? (
            <Button variant={filterCount > 0 ? "secondary" : "outline"} size="sm" onClick={() => setPanel("filters")}>
              <Filter /> Filters{filterCount > 0 ? ` (${filterCount})` : ""}
            </Button>
          ) : null}
          {columns.some((column) => column.sortable) ? (
            <Button variant={sort ? "secondary" : "outline"} size="sm" onClick={() => setPanel("sort")}>
              <ArrowUpDown /> Sort
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setPanel("columns")}>
            <Columns3 /> Columns
          </Button>
          {mode === "client" || exportHref ? (
            exportHref ? (
              <Button variant="outline" size="sm" asChild>
                <a href={exportHref}>
                  <Download /> Export
                </a>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download /> Export
              </Button>
            )
          ) : null}
          {toolbarExtra}
        </div>
      </div>

      {filterCount > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
          {Object.entries(query.filters).map(([key, values]) => {
            const column = columns.find((candidate) => candidate.key === key);
            const text = column?.type === "number" || column?.type === "date" ? values.join(" – ") : values.map((value) => (column ? optionLabel(column, value) : value)).join(", ");
            return (
              <Badge key={key} variant="outline" className="gap-1.5 pr-1">
                <span className="text-muted-foreground">{column?.label ?? key}:</span> {text}
                <button type="button" aria-label={`Remove ${column?.label ?? key} filter`} className="hover:bg-accent rounded-full p-0.5" onClick={() => push({ [`f.${key}`]: undefined })}>
                  <X className="size-3" />
                </button>
              </Badge>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => push(Object.fromEntries(Object.keys(query.filters).map((key) => [`f.${key}`, undefined])))}
          >
            Clear all
          </Button>
        </div>
      ) : null}

      <div className={cn("transition-opacity", pending && "opacity-60")}>
        <Table className={cn(compact ? "text-xs" : "text-sm")}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {shown.map((column) => {
                const active = sort?.key === column.key ? sort.dir : null;
                const label = column.label || column.columnPickerLabel || "";
                return (
                  <TableHead key={column.key} aria-sort={active ? (active === "asc" ? "ascending" : "descending") : undefined} className={cn(column.align === "right" && "text-right", column.align === "center" && "text-center", "bg-muted/40")}>
                    {column.sortable && label ? (
                      <button type="button" onClick={() => changeSort(column.key)} className="hover:text-foreground inline-flex items-center gap-1 font-medium" title={column.headerHint}>
                        {label}
                        {active === "asc" ? <ArrowUp className="size-3.5" /> : active === "desc" ? <ArrowDown className="size-3.5" /> : <ArrowUpDown className="text-muted-foreground/50 size-3.5" />}
                      </button>
                    ) : (
                      <span title={column.headerHint}>{column.label}</span>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colSpan} className="text-muted-foreground h-32 text-center whitespace-normal">
                  {emptyMessage ?? (filterCount > 0 || query.search ? "No rows match these filters." : "Nothing here yet.")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => {
                const issues = rowIssues?.(row) ?? [];
                const worst = issues.find((issue) => issue.tone === "danger") ?? issues[0];
                const href = rowHref?.(row);
                return (
                  <TableRow
                    key={keyOf(row, index)}
                    className={cn(
                      href && "cursor-pointer",
                      worst?.tone === "danger" && "bg-danger-soft/50 hover:bg-danger-soft",
                      worst?.tone === "warning" && "bg-warning-soft/50 hover:bg-warning-soft",
                    )}
                    onClick={
                      href
                        ? (event) => {
                            if ((event.target as HTMLElement).closest("a,button,input,select,label,[role=checkbox]")) return;
                            router.push(href);
                          }
                        : undefined
                    }
                  >
                    {shown.map((column, columnIndex) => {
                      const value = row[column.key];
                      const content = column.render ? (
                        column.render(value, row)
                      ) : column.badgeTones && value !== null && value !== undefined && value !== "" ? (
                        <Badge variant={column.badgeTones[String(value)] ?? "neutral"}>{optionLabel(column, String(value))}</Badge>
                      ) : Array.isArray(value) ? (
                        value.join(", ")
                      ) : column.enumValues && typeof value === "string" ? (
                        optionLabel(column, value)
                      ) : value === null || value === undefined || value === "" ? (
                        <span className="text-muted-foreground">–</span>
                      ) : (
                        String(value)
                      );
                      return (
                        <TableCell key={column.key} className={cn(column.align === "right" && "text-right", column.align === "center" && "text-center", column.className)}>
                          {columnIndex === 0 && worst ? (
                            <span className="inline-flex items-center gap-1.5" title={worst.message}>
                              <TriangleAlert className={cn("size-3.5 shrink-0", worst.tone === "danger" ? "text-danger" : "text-warning")} />
                              {content}
                            </span>
                          ) : (
                            content
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5">
        <div className="text-muted-foreground flex items-center gap-3 text-sm tabular-nums">
          <span>{totalRows === 0 ? "0 results" : `${first}–${last} of ${totalRows}`}</span>
          <label className="flex items-center gap-1.5">
            <span className="sr-only sm:not-sr-only">Rows</span>
            <NativeSelect value={query.pageSize} onChange={(event) => changePageSize(Number(event.target.value))} aria-label="Rows per page" className="h-8 w-20 text-sm">
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        {pageCount > 1 ? (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => push({ page: String(page - 1) })} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="px-2 text-sm tabular-nums">
              {page} / {pageCount}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => push({ page: String(page + 1) })} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        ) : null}
      </nav>

      <FiltersSheet open={panel === "filters"} onClose={() => setPanel(null)} columns={columns} query={query} onApply={(filters) => push({ ...Object.fromEntries(columns.filter((column) => column.filterable).map((column) => [`f.${column.key}`, undefined])), ...Object.fromEntries(Object.entries(filters).map(([key, values]) => [`f.${key}`, values])) })} />
      <SortSheet open={panel === "sort"} onClose={() => setPanel(null)} columns={columns} sort={sort} onApply={(value) => push({ sort: value || undefined })} />
      <ColumnsSheet
        open={panel === "columns"}
        onClose={() => setPanel(null)}
        columns={columns}
        visible={visible}
        onChange={setColumns}
        onReset={() => {
          setVisible(orderedVisible(columns));
          saveCookie(tableId, { pageSize: query.pageSize });
        }}
      />
    </div>
  );
}

function FiltersSheet<T>({ open, onClose, columns, query, onApply }: { open: boolean; onClose: () => void; columns: ColumnDef<T>[]; query: DataTableQuery; onApply: (filters: Record<string, string[]>) => void }) {
  const [draft, setDraft] = useState<Record<string, string[]>>(query.filters);
  useEffect(() => {
    if (open) setDraft(query.filters);
  }, [open]);
  const set = (key: string, values: string[]) => setDraft((current) => ({ ...current, [key]: values.filter((value, index) => value !== "" || index === 1 || values.length > 1) }));
  const clean = (filters: Record<string, string[]>) => Object.fromEntries(Object.entries(filters).filter(([, values]) => values.some((value) => value !== "")));

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the list. Applied filters stay in the link, so you can share this view.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-4">
          {columns
            .filter((column) => column.filterable)
            .map((column) => {
              const values = draft[column.key] ?? [];
              const id = `filter-${column.key}`;
              if (column.type === "enum" || (column.type !== "number" && column.type !== "date" && column.type !== "boolean" && column.filterVariant === "select")) {
                return (
                  <fieldset key={column.key} className="grid gap-2">
                    <legend className="mb-1 text-sm font-medium">{column.label}</legend>
                    <div className="grid max-h-56 gap-1.5 overflow-y-auto">
                      {(column.enumValues ?? []).map((option) => {
                        const checked = values.includes(option.value);
                        return (
                          <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
                            <Checkbox checked={checked} onCheckedChange={(next) => set(column.key, next ? [...values, option.value] : values.filter((value) => value !== option.value))} />
                            {option.label}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              }
              if (column.type === "number" || column.type === "date") {
                const inputType = column.type === "date" ? "date" : "number";
                return (
                  <div key={column.key} className="grid gap-1.5">
                    <Label htmlFor={`${id}-from`}>{column.label}</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input id={`${id}-from`} type={inputType} aria-label={`${column.label} from`} value={values[0] ?? ""} onChange={(event) => set(column.key, [event.target.value, values[1] ?? ""])} />
                      <Input id={`${id}-to`} type={inputType} aria-label={`${column.label} to`} value={values[1] ?? ""} onChange={(event) => set(column.key, [values[0] ?? "", event.target.value])} />
                    </div>
                  </div>
                );
              }
              if (column.type === "boolean") {
                return (
                  <div key={column.key} className="grid gap-1.5">
                    <Label htmlFor={id}>{column.label}</Label>
                    <NativeSelect id={id} value={values[0] ?? ""} onChange={(event) => set(column.key, event.target.value ? [event.target.value] : [])}>
                      <option value="">Any</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </NativeSelect>
                  </div>
                );
              }
              return (
                <div key={column.key} className="grid gap-1.5">
                  <Label htmlFor={id}>{column.label}</Label>
                  <Input id={id} value={values[0] ?? ""} onChange={(event) => set(column.key, event.target.value ? [event.target.value] : [])} />
                </div>
              );
            })}
        </div>
        <SheetFooter className="flex-row gap-2">
          <Button
            onClick={() => {
              onApply(clean(draft));
              onClose();
            }}
          >
            Apply
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({});
              onApply({});
              onClose();
            }}
          >
            Clear
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SortSheet<T>({ open, onClose, columns, sort, onApply }: { open: boolean; onClose: () => void; columns: ColumnDef<T>[]; sort: { key: string; dir: "asc" | "desc" } | null; onApply: (value: string) => void }) {
  const [key, setKey] = useState(sort?.key ?? "");
  const [dir, setDir] = useState<"asc" | "desc">(sort?.dir ?? "asc");
  useEffect(() => {
    if (open) {
      setKey(sort?.key ?? "");
      setDir(sort?.dir ?? "asc");
    }
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Sort</SheetTitle>
          <SheetDescription>You can also click a column heading.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4">
          <div className="grid gap-1.5">
            <Label htmlFor="sort-column">Column</Label>
            <NativeSelect id="sort-column" value={key} onChange={(event) => setKey(event.target.value)}>
              <option value="">Default order</option>
              {columns
                .filter((column) => column.sortable)
                .map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label || column.columnPickerLabel || column.key}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sort-dir">Direction</Label>
            <NativeSelect id="sort-dir" value={dir} onChange={(event) => setDir(event.target.value as "asc" | "desc")} disabled={!key}>
              <option value="asc">Ascending (A → Z, oldest first)</option>
              <option value="desc">Descending (Z → A, newest first)</option>
            </NativeSelect>
          </div>
        </div>
        <SheetFooter className="flex-row gap-2">
          <Button
            onClick={() => {
              onApply(key ? (dir === "desc" ? `-${key}` : key) : "");
              onClose();
            }}
          >
            Apply
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ColumnsSheet<T>({ open, onClose, columns, visible, onChange, onReset }: { open: boolean; onClose: () => void; columns: ColumnDef<T>[]; visible: string[]; onChange: (next: string[]) => void; onReset: () => void }) {
  // Visible columns first, in their order (movable); then the hidden ones.
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const shownColumns = visible.map((key) => byKey.get(key)).filter((column): column is ColumnDef<T> => Boolean(column));
  const hiddenColumns = columns.filter((column) => !visible.includes(column.key));
  const move = (index: number, by: -1 | 1) => {
    const next = [...visible];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const name = (column: ColumnDef<T>) => column.label || column.columnPickerLabel || column.key;
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Columns</SheetTitle>
          <SheetDescription>Show, hide and reorder. Your choice is remembered on this device.</SheetDescription>
        </SheetHeader>
        <ul className="grid gap-1 px-4">
          {shownColumns.map((column, index) => (
            <li key={column.key} className="flex items-center gap-2 text-sm">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1">
                <Checkbox checked disabled={column.hideable === false} onCheckedChange={() => onChange(visible.filter((key) => key !== column.key))} />
                <span className="truncate">{name(column)}</span>
              </label>
              <Button variant="ghost" size="icon" className="size-7" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${name(column)} up`}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" disabled={index === shownColumns.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${name(column)} down`}>
                <ArrowDown className="size-3.5" />
              </Button>
            </li>
          ))}
          {hiddenColumns.length > 0 ? <li className="text-muted-foreground mt-3 text-xs font-medium uppercase">Hidden</li> : null}
          {hiddenColumns.map((column) => (
            <li key={column.key}>
              <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                <Checkbox checked={false} onCheckedChange={() => onChange([...visible, column.key])} />
                <span className="truncate">{name(column)}</span>
              </label>
            </li>
          ))}
        </ul>
        <SheetFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onReset}>
            Reset to default
          </Button>
          <Button onClick={onClose}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
