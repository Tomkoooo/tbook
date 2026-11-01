import type { ReactNode } from "react";

/** Label/value rows for detail panels; stacks on narrow screens. */
export function DescriptionList({ items }: { items: Array<{ label: ReactNode; value: ReactNode }> }) {
  return (
    <dl className="divide-border divide-y text-sm">
      {items.map((item, index) => (
        <div key={index} className="grid gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[10rem_1fr] sm:gap-4">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
