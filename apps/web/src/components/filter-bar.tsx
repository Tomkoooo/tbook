import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * FilterBar — the filter strip above a list. A plain GET form (no client JS):
 * submitting reloads the same page with the filters in the query string, which
 * is the state the server component reads.
 *
 *   <FilterBar action="/admin/bookings" clearHref="/admin/bookings" activeCount={2}
 *     more={<>…less-used fields…</>} moreActive={hasAdvanced}>
 *     <FormField label="Search">…</FormField>
 *   </FilterBar>
 *
 * Props:
 *   action       form action (the list's path)
 *   clearHref    where "Clear" goes; shown only when activeCount > 0 (or always when omitted count)
 *   activeCount  how many filters are applied; shows "Clear (n)"
 *   children     the primary fields, laid out in a responsive grid (1 / 2 / 4 columns)
 *   more         secondary fields, tucked in a "More filters" disclosure
 *   moreActive   open the disclosure on load (a secondary filter is applied)
 *   submitLabel  default "Apply"
 *   hidden       extra hidden inputs (e.g. keep `sortBy`), as elements
 */
export function FilterBar({
  action,
  clearHref,
  activeCount,
  children,
  more,
  moreActive,
  submitLabel = "Apply",
  hidden,
  className,
}: {
  action: string;
  clearHref?: string;
  activeCount?: number;
  children: ReactNode;
  more?: ReactNode;
  moreActive?: boolean;
  submitLabel?: string;
  hidden?: ReactNode;
  className?: string;
}) {
  return (
    <form method="get" action={action} className={cn("bg-card grid gap-4 rounded-xl border p-3 shadow-xs sm:p-4", className)}>
      {hidden}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      {more ? (
        <details open={moreActive} className="group">
          <summary className="text-muted-foreground hover:text-foreground flex w-fit list-none items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="size-4" /> More filters
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{more}</div>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">{submitLabel}</Button>
        {clearHref && (activeCount === undefined || activeCount > 0) ? (
          <Button variant="ghost" asChild>
            <Link href={clearHref}>Clear{activeCount ? ` (${activeCount})` : ""}</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
