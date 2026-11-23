import type { ReactNode } from "react";

/**
 * DataTable engine (tCrm template, docs/07-datatable.md). One definition per
 * column feeds the toolbar (search, filters, sort, columns), the table and the
 * export. State lives in the URL (`search`, `sort`, `page`, `pageSize`,
 * `f.<key>`), so every list is linkable and the back button works.
 */

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral" | "note";

export type ColumnType = "string" | "number" | "date" | "boolean" | "enum";

export interface ColumnDef<T> {
  /** Key of the row object (and of the `f.<key>` / `sort` URL params). */
  key: string;
  label: string;
  /** Label in the Columns panel when `label` is empty. */
  columnPickerLabel?: string;
  type?: ColumnType;
  sortable?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  /** `enum` columns, and `string` columns with `filterVariant: "select"`. */
  enumValues?: Array<{ value: string; label: string }>;
  filterVariant?: "text" | "select";
  /** The cell shows as a coloured badge (value → tone). */
  badgeTones?: Record<string, BadgeTone>;
  align?: "left" | "right" | "center";
  /** `false` = cannot be hidden in the Columns panel. */
  hideable?: boolean;
  /** `false` = hidden until switched on in the Columns panel. */
  defaultVisible?: boolean;
  headerHint?: string;
  className?: string;
  /** Client component only (functions can't cross from a server page). */
  render?: (value: unknown, row: T) => ReactNode;
  exportValue?: (row: T) => string | number | Date | null | undefined;
  /** `false` = left out of the export (action buttons). */
  exportable?: boolean;
}

export interface DataTableQuery {
  search: string;
  /** Column key; a `-` prefix means descending. Empty = the page's default order. */
  sort: string;
  page: number;
  pageSize: number;
  /** `f.<key>` params: repeatable (multi-select); for number/date the 1st value is "from", the 2nd "to". */
  filters: Record<string, string[]>;
}

export interface RowIssue {
  tone: "warning" | "danger";
  message: string;
}

export interface TablePrefs {
  /** Visible columns in display order. */
  columns?: string[];
  pageSize?: number;
}

export const PAGE_SIZES = [10, 25, 50, 100, 250] as const;
export const DEFAULT_PAGE_SIZE = 25;
