"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/** Path segments that read better than their raw URL form. */
const SEGMENT_LABELS: Record<string, string> = {
  admin: "Dashboard",
  "check-in": "Check-in",
  "select-org": "Select organization",
  new: "New",
};

function labelFor(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  // Object ids and other opaque segments are not worth showing as a crumb label.
  if (/^[0-9a-f]{24}$/i.test(segment)) return "Details";
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
}

export function AdminHeader() {
  const segments = usePathname().split("/").filter(Boolean);
  const crumbs = segments.map(labelFor);

  return (
    <header className="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.map((crumb, index) => (
            <BreadcrumbItem key={`${crumb}-${index}`}>
              {index === crumbs.length - 1 ? (
                <BreadcrumbPage>{crumb}</BreadcrumbPage>
              ) : (
                <>
                  <span className="text-muted-foreground">{crumb}</span>
                  <BreadcrumbSeparator />
                </>
              )}
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
