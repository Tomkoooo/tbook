import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Link-based paging: table state lives in the URL, so every page is
 * shareable, bookmarkable and survives a reload.
 */
export function LinkPagination({
  page,
  pageCount,
  total,
  hrefForPage,
}: {
  page: number;
  pageCount: number;
  total?: number;
  hrefForPage: (page: number) => string;
}) {
  const summary = total === undefined ? null : `${total} result${total === 1 ? "" : "s"}`;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2 border-t px-4 py-3">
      <span className="text-muted-foreground text-sm tabular-nums">
        {pageCount > 1 ? `Page ${page} of ${pageCount}` : null}
        {pageCount > 1 && summary ? " · " : null}
        {summary}
      </span>
      {pageCount > 1 ? (
        <div className="flex gap-2">
          <PageLink href={page > 1 ? hrefForPage(page - 1) : null} rel="prev">
            <ChevronLeft /> Previous
          </PageLink>
          <PageLink href={page < pageCount ? hrefForPage(page + 1) : null} rel="next">
            Next <ChevronRight />
          </PageLink>
        </div>
      ) : null}
    </nav>
  );
}

function PageLink({ href, rel, children }: { href: string | null; rel: string; children: React.ReactNode }) {
  if (!href) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={href} rel={rel}>
        {children}
      </Link>
    </Button>
  );
}
