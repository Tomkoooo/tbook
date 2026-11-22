import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A titled shadcn Card — the console's standard panel.
 *
 * Props:
 *   title, description  header text
 *   icon                Lucide icon shown in front of the title
 *   actions             controls at the right of the header
 *   flush               removes the body padding so a Table runs edge to edge
 *                       under a bordered header
 *   footer              content under the body, separated by a rule
 *   id                  anchor target (the card gets scroll-mt for the sticky header)
 *   className, children
 */
export function SectionCard({
  title,
  description,
  icon,
  actions,
  flush,
  footer,
  id,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  footer?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <Card
      id={id}
      className={cn(
        "scroll-mt-20 gap-4 py-4 shadow-xs sm:py-5",
        flush && "gap-0 overflow-hidden pb-0",
        flush && !hasHeader && "pt-0",
        className,
      )}
    >
      {hasHeader ? (
        <CardHeader className={cn("px-4 sm:px-5", flush && "border-b [.border-b]:pb-4")}>
          {title ? (
            <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:shrink-0">
              {icon}
              {title}
            </CardTitle>
          ) : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
          {actions ? <CardAction className="flex flex-wrap justify-end gap-2">{actions}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent
        className={cn(
          "px-4 sm:px-5",
          flush && "px-0 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4 sm:[&_td:first-child]:pl-5 sm:[&_td:last-child]:pr-5 sm:[&_th:first-child]:pl-5 sm:[&_th:last-child]:pr-5",
        )}
      >
        {children}
      </CardContent>
      {footer ? (
        <div className={cn("text-muted-foreground border-t px-4 pt-4 text-sm sm:px-5", flush && "pb-4 sm:pb-5")}>{footer}</div>
      ) : null}
    </Card>
  );
}
