import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** KPI row: 2 columns on phones, up to 6 on wide screens. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

/** One KPI readout: label, value (tabular figures), optional hint. */
export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="gap-1 px-4 py-3 shadow-none">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <strong className="text-2xl font-semibold tracking-tight tabular-nums">{value}</strong>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </Card>
  );
}
