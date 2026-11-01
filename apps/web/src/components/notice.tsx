import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle } as const;

/** Inline status message built on the shadcn Alert. */
export function Notice({ tone = "info", children }: { tone?: keyof typeof ICONS; children: ReactNode }) {
  const Icon = ICONS[tone];
  return (
    <Alert variant={tone} role={tone === "danger" ? "alert" : "status"}>
      <Icon />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
