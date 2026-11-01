import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Save bar that stays at the bottom of the screen while a long form
 * scrolls, so the primary action is always reachable (tablets included).
 * Put it as the last child of the <form>.
 */
export function StickyFormFooter({ children, status, className }: { children: ReactNode; status?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t px-4 py-3 backdrop-blur md:-mx-6 md:px-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {status ? <div className="text-muted-foreground ml-auto text-sm">{status}</div> : null}
    </div>
  );
}

/** "Unsaved changes" dot for the save bar. */
export function UnsavedBadge({ dirty }: { dirty: boolean }) {
  if (!dirty) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="bg-warning size-2 rounded-full" aria-hidden /> Unsaved changes
    </span>
  );
}
