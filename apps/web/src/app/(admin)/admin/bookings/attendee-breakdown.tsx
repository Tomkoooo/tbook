import Link from "next/link";
import type { AttendeeBreakdown } from "@tbook/services";
import { ChevronDown } from "lucide-react";
import { hrefWithParams } from "@/lib/table-sort";
import { ANSWER_PREFIX } from "./list-columns";

type Params = Record<string, string | string[] | undefined>;

const TOP_VALUES = 6;

/**
 * How the guests in the current view answered each choice question —
 * "Shirt size: M 41, L 38…" — as bars you can click: a bar narrows the list
 * to the guests who gave that answer. Counts follow the filters, so with a
 * filter on, this is the split *within* it.
 */
export function AttendeeBreakdowns({ breakdowns, basePath, params }: { breakdowns: AttendeeBreakdown[]; basePath: string; params: Params }) {
  if (breakdowns.length === 0) return null;
  return (
    <details open className="group">
      <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Answers at a glance · {breakdowns.length} question{breakdowns.length === 1 ? "" : "s"}
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {breakdowns.map((breakdown) => {
          const max = Math.max(...breakdown.rows.map((row) => row.count), 1);
          const shown = breakdown.rows.slice(0, TOP_VALUES);
          const rest = breakdown.rows.length - shown.length;
          return (
            <section key={breakdown.fieldKey} className="bg-card rounded-xl border p-3 shadow-xs">
              <h3 className="mb-2 truncate text-sm font-medium">{breakdown.label}</h3>
              <ul className="grid gap-1">
                {shown.map((row) => {
                  const content = (
                    <>
                      <span className="truncate">{row.label}</span>
                      <span className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
                        <span className="bg-primary block h-full rounded-full" style={{ width: `${Math.round((row.count / max) * 100)}%` }} />
                      </span>
                      <span className="text-right tabular-nums">{row.count}</span>
                    </>
                  );
                  const className = "grid h-7 grid-cols-[minmax(3rem,6rem)_1fr_2.5rem] items-center gap-2 text-sm";
                  return (
                    <li key={row.value}>
                      {row.value === "" ? (
                        <div className={className}>{content}</div>
                      ) : (
                        <Link
                          href={hrefWithParams(basePath, params, { [`f.${ANSWER_PREFIX}${breakdown.fieldKey}`]: row.value, page: undefined })}
                          title={`${row.label}: ${row.count} of ${breakdown.total} (${Math.round((row.count / Math.max(breakdown.total, 1)) * 100)}%) — click to filter`}
                          className={`${className} hover:bg-accent -mx-1.5 rounded px-1.5`}
                        >
                          {content}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
              {rest > 0 ? <p className="text-muted-foreground mt-1.5 text-xs">+ {rest} more — use Filters.</p> : null}
            </section>
          );
        })}
      </div>
    </details>
  );
}
