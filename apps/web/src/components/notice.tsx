import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, StickyNote, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle, note: StickyNote } as const;

/**
 * Notice — inline status message on the shadcn Alert.
 *
 * Props:
 *   tone      "info" (default) | "success" | "warning" | "danger" | "note"
 *   title     optional bold first line
 *   action    optional button/link under the message
 *   children  the message
 */
export function Notice({
  tone = "info",
  title,
  action,
  children,
}: {
  tone?: keyof typeof ICONS;
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const Icon = ICONS[tone];
  return (
    <Alert variant={tone} role={tone === "danger" ? "alert" : "status"}>
      <Icon />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>
        {children}
        {action ? <div className="mt-1">{action}</div> : null}
      </AlertDescription>
    </Alert>
  );
}
