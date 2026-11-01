import type { ReactNode } from "react";

/** Centered "nothing here" message for empty tables and panels. */
export function EmptyState({ title, hint, icon }: { title: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
      {icon ? <div className="text-muted-foreground mb-2 [&_svg]:size-6">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="text-muted-foreground max-w-sm text-sm">{hint}</p> : null}
    </div>
  );
}
