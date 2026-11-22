import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * EmptyState — "nothing here yet", with the way forward.
 *
 * Props:
 *   title    what is empty ("No bookings yet")
 *   hint     one sentence on why / what to do
 *   icon     a Lucide icon element, shown in a soft circle
 *   action   a button or link (the CTA)
 *   variant  "inline" (default) — no frame, for use inside a table card
 *            "panel"            — muted box with a border, for a section
 *            "hero"             — dashed frame and generous height, for a page that is empty
 */
export function EmptyState({
  title,
  hint,
  icon,
  action,
  variant = "inline",
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  variant?: "inline" | "panel" | "hero";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 px-4 text-center",
        variant === "inline" && "py-10",
        variant === "panel" && "bg-muted/30 rounded-lg border py-12",
        variant === "hero" && "rounded-xl border-2 border-dashed py-16 sm:py-20",
        className,
      )}
    >
      {icon ? (
        <div className="bg-muted text-muted-foreground mb-2 flex size-12 items-center justify-center rounded-full [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="text-muted-foreground max-w-sm text-sm">{hint}</p> : null}
      {action ? <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
