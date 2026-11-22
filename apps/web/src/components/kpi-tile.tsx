import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TONE_CLASSES, type StatusTone } from "@/lib/status-tones";
import { cn } from "@/lib/utils";

/**
 * KpiTile — one headline number (tCrm template pattern).
 *
 *   <KpiTile label="Pending bookings" value={12} hint="last 30 days"
 *            tone="warning" icon={<Clock />} href="/admin/bookings?status=pending" />
 *
 * Props:
 *   label      short caption above the value
 *   value      the figure (rendered with tabular numerals)
 *   hint       optional small line under the value (period, delta, unit)
 *   tone       "neutral" (default) | "info" | "success" | "warning" | "danger" | "note";
 *              tints the icon chip, or draws a coloured dot when there is no icon
 *   icon       a Lucide icon element, shown in a chip at the top right
 *   href       makes the whole tile a link (pre-filtered list); shows an arrow
 *   className  extra classes on the card
 *
 * Server component; works in client components too. Put several in a KpiGrid.
 */
export function KpiTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  href,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatusTone;
  icon?: ReactNode;
  href?: string;
  className?: string;
}) {
  const tones = TONE_CLASSES[tone];
  const exportable = typeof value === "string" || typeof value === "number";
  const card = (
    <Card
      className={cn(
        "h-full gap-1 p-4 shadow-none",
        href && "hover:border-ring/60 hover:bg-muted/40 transition-colors",
        className,
      )}
      data-export-label={typeof label === "string" ? label : undefined}
      data-export-value={exportable ? String(value) : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium">
          {!icon && tone !== "neutral" ? <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tones.dot)} /> : null}
          <span className="truncate">{label}</span>
        </span>
        {icon ? (
          <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", tones.chip)}>
            {icon}
          </span>
        ) : href ? (
          <ArrowUpRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
        ) : null}
      </div>
      <strong className="num text-2xl leading-8 font-semibold tracking-tight break-words">{value}</strong>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </Card>
  );
  if (!href) return card;
  return (
    <Link href={href} className="focus-visible:ring-ring/50 block rounded-xl outline-none focus-visible:ring-[3px]">
      {card}
    </Link>
  );
}

/** KPI row. `cols` is the column count on wide screens (always 2 on phones). Default 4. */
export function KpiGrid({ cols = 4, children, className }: { cols?: 2 | 3 | 4 | 5 | 6; children: ReactNode; className?: string }) {
  const wide = {
    2: "md:grid-cols-2",
    3: "md:grid-cols-3",
    4: "md:grid-cols-2 xl:grid-cols-4",
    5: "md:grid-cols-3 xl:grid-cols-5",
    6: "md:grid-cols-3 xl:grid-cols-6",
  }[cols];
  return <div className={cn("grid grid-cols-2 gap-3 md:gap-4", wide, className)}>{children}</div>;
}
