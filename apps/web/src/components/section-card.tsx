import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A titled shadcn Card — the console's standard panel. `flush` removes the
 * body padding so a Table runs edge to edge under a bordered header.
 */
export function SectionCard({
  title,
  description,
  actions,
  flush,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <Card className={cn("gap-4 py-5", flush && "gap-0 overflow-hidden pb-0", flush && !hasHeader && "pt-0", className)}>
      {hasHeader ? (
        <CardHeader className={cn("px-5", flush && "border-b [.border-b]:pb-4")}>
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
          {actions ? <CardAction className="flex flex-wrap gap-2">{actions}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn("px-5", flush && "px-0 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5")}>{children}</CardContent>
    </Card>
  );
}
