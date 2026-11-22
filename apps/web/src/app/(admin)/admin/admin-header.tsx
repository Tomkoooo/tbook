"use client";

import { Fragment, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette } from "@/components/shell/command-palette";
import { buildCrumbs } from "@/lib/crumbs";
import { useShellEntities } from "@/components/shell/use-shell-entities";
import { useWorkspace } from "@/components/shell/workspace-store";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { routeContext } from "@/lib/event-routes";
import { EXTRA_PAGES, NAV_GROUPS, PLATFORM_ITEMS, filterNavGroups, isNavItemVisible, type NavItem } from "@/lib/nav-config";

export function AdminHeader({
  permissions,
  modules,
  isSystemAdmin,
}: {
  permissions: string[];
  /** Modules granted to the active organization. */
  modules: string[];
  isSystemAdmin: boolean;
}) {
  const pathname = usePathname();
  const context = routeContext(pathname);
  const contextId = context.kind === "event" ? context.eventId : context.kind === "group" ? context.groupId : null;
  const workspace = useWorkspace(context.kind === "group" ? "group" : "event", contextId);

  // The workspace layout registers its name before paint; the shared cached lookup only
  // covers the instant before that (and keeps the palette's lists warm).
  const { entities, refresh } = useShellEntities(contextId !== null && !workspace);
  const lookedUp =
    context.kind === "event"
      ? entities.events.find((event) => event.id === context.eventId)?.name
      : context.kind === "group"
        ? entities.groups.find((group) => group.id === context.groupId)?.name
        : undefined;
  const workspaceName = workspace?.name ?? lookedUp ?? null;

  const pages = useMemo<NavItem[]>(() => {
    const access = { permissions, modules };
    const fromNav = filterNavGroups(NAV_GROUPS, access).flatMap((group) => group.items);
    const platform = isSystemAdmin ? PLATFORM_ITEMS : [];
    const extra = EXTRA_PAGES.filter((item) => isNavItemVisible(item, access));
    return [...fromNav, ...platform, ...extra];
  }, [permissions, modules, isSystemAdmin]);

  const crumbs = buildCrumbs(pathname, { event: workspaceName, group: workspaceName });

  return (
    <header className="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            const label = crumb.label ?? <Skeleton className="h-4 w-24" />;
            return (
              <Fragment key={crumb.href}>
                {index > 0 ? <BreadcrumbSeparator className="max-sm:hidden" /> : null}
                <BreadcrumbItem className={last ? "min-w-0" : "max-sm:hidden"}>
                  {last ? (
                    <BreadcrumbPage className="truncate">{label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <CommandPalette pages={pages} entities={entities} workspace={workspace} onOpen={refresh} />
      <ThemeToggle />
    </header>
  );
}
