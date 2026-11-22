import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/section-card";

/**
 * Panel — a titled card for dashboards, with an optional "All" link
 * (tCrm template pattern). A thin layer over SectionCard.
 *
 *   <Panel title="Latest bookings" href="/admin/bookings" flush>…table…</Panel>
 *
 * Props:
 *   title, description   header text
 *   href, hrefLabel      adds a ghost link at the top right (label defaults to "All")
 *   actions              extra header controls, shown before the link
 *   flush                no body padding, so a table runs edge to edge
 *   footer               content under the body, separated by a rule
 *   className, children
 */
export function Panel({
  title,
  description,
  href,
  hrefLabel = "All",
  actions,
  flush,
  footer,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  href?: string;
  hrefLabel?: string;
  actions?: ReactNode;
  flush?: boolean;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <SectionCard
      title={title}
      description={description}
      flush={flush}
      footer={footer}
      className={className}
      actions={
        actions || href ? (
          <>
            {actions}
            {href ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href={href}>
                  {hrefLabel} <ArrowRight />
                </Link>
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {children}
    </SectionCard>
  );
}
