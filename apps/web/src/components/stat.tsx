import type { ComponentProps, ReactNode } from "react";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";

/**
 * Original KPI API, kept so existing pages keep working: `Stat` is a KpiTile
 * and `StatGrid` is a KpiGrid (2 columns on phones, 3 on tablets, 6 on wide
 * screens). New code should use KpiTile / KpiGrid directly.
 */
export function StatGrid({ children }: { children: ReactNode }) {
  return <KpiGrid cols={6}>{children}</KpiGrid>;
}

export function Stat(props: ComponentProps<typeof KpiTile>) {
  return <KpiTile {...props} />;
}
