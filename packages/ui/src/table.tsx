import type { ReactNode } from "react";

/**
 * Thin semantic wrappers rather than a configurable DataTable component.
 * Each admin table has different cells and actions, and a generic
 * column-config abstraction over four tables costs more than it saves —
 * the shared part is the styling, which is what these carry.
 */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="tbook-table-scroll">
      <table className={["tbook-table", className].filter(Boolean).join(" ")}>{children}</table>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="tbook-empty">
      <p className="tbook-empty-title">{title}</p>
      {hint ? <p className="tbook-empty-hint">{hint}</p> : null}
    </div>
  );
}

export interface PaginationProps {
  page: number;
  pageCount: number;
  /** Builds the href for a page — the caller owns URL shape (filters are in the query string). */
  hrefForPage: (page: number) => string;
  total?: number;
}

/**
 * Link-based paging, not buttons: the admin table's whole state lives in
 * the URL, so a page is shareable, bookmarkable and survives a reload.
 */
export function Pagination({ page, pageCount, hrefForPage, total }: PaginationProps) {
  if (pageCount <= 1) {
    return total === undefined ? null : <p className="tbook-pagination-summary">{total} result{total === 1 ? "" : "s"}</p>;
  }

  return (
    <nav className="tbook-pagination" aria-label="Pagination">
      {page > 1 ? (
        <a className="tbook-btn tbook-btn-secondary" href={hrefForPage(page - 1)} rel="prev">
          Previous
        </a>
      ) : (
        <span className="tbook-btn tbook-btn-secondary tbook-btn-disabled" aria-disabled="true">
          Previous
        </span>
      )}
      <span className="tbook-pagination-summary">
        Page {page} of {pageCount}
        {total === undefined ? "" : ` · ${total} result${total === 1 ? "" : "s"}`}
      </span>
      {page < pageCount ? (
        <a className="tbook-btn tbook-btn-secondary" href={hrefForPage(page + 1)} rel="next">
          Next
        </a>
      ) : (
        <span className="tbook-btn tbook-btn-secondary tbook-btn-disabled" aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}
