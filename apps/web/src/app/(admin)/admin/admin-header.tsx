"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette } from "@/components/shell/command-palette";
import { loadShellEntitiesAction, type ShellEntities } from "@/components/shell/shell-actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { EXTRA_PAGES, NAV_GROUPS, PLATFORM_ITEMS, filterNavGroups, isNavItemVisible, type NavItem } from "@/lib/nav-config";

/** Path segments that read better than their raw URL form. */
const SEGMENT_LABELS: Record<string, string> = {
  admin: "Dashboard",
  "check-in": "Check-in",
  "select-org": "Select organization",
  members: "Team",
  email: "Booking email",
  new: "New",
  bus: "Bus transfers",
  vip: "VIP guests",
  "device-link": "Device link",
};

const OBJECT_ID = /^[0-9a-f]{24}$/i;
/** Parent segments whose child id is an event / an event group. */
const EVENT_PARENTS = new Set(["events", "check-in"]);
const GROUP_PARENTS = new Set(["groups"]);

const NO_ENTITIES: ShellEntities = { events: [], groups: [] };

export function crumbLabel(segment: string, previous: string | undefined, entities: ShellEntities): string {
  if (OBJECT_ID.test(segment)) {
    if (previous && EVENT_PARENTS.has(previous)) {
      const event = entities.events.find((candidate) => candidate.id === segment);
      if (event) return event.name;
    }
    if (previous && GROUP_PARENTS.has(previous)) {
      const group = entities.groups.find((candidate) => candidate.id === segment);
      if (group) return group.name;
    }
    // Other opaque ids (a hotel, a booking, a route) have no cheap name here.
    return "Details";
  }
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
}

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
  const segments = pathname.split("/").filter(Boolean);
  const [entities, setEntities] = useState<ShellEntities>(NO_ENTITIES);
  const loadedAt = useRef(0);

  const refresh = useCallback(() => {
    // Cheap guard against reloading on every palette toggle.
    if (Date.now() - loadedAt.current < 30_000) return;
    loadedAt.current = Date.now();
    loadShellEntitiesAction()
      .then(setEntities)
      .catch(() => {
        loadedAt.current = 0;
      });
  }, []);

  // Names are needed up front only when the page's URL contains an event or group id.
  const needsNames = segments.some((segment, index) => OBJECT_ID.test(segment) && (EVENT_PARENTS.has(segments[index - 1] ?? "") || GROUP_PARENTS.has(segments[index - 1] ?? "")));
  useEffect(() => {
    if (needsNames) refresh();
  }, [needsNames, pathname, refresh]);

  const pages = useMemo<NavItem[]>(() => {
    const access = { permissions, modules };
    const fromNav = filterNavGroups(NAV_GROUPS, access).flatMap((group) => group.items);
    const platform = isSystemAdmin ? PLATFORM_ITEMS : [];
    const extra = EXTRA_PAGES.filter((item) => isNavItemVisible(item, access));
    return [...fromNav, ...platform, ...extra];
  }, [permissions, modules, isSystemAdmin]);

  const crumbs = segments.map((segment, index) => ({
    label: crumbLabel(segment, segments[index - 1], entities),
    href: `/${segments.slice(0, index + 1).join("/")}`,
  }));

  return (
    <header className="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.href}>
              {index > 0 ? <BreadcrumbSeparator className="max-sm:hidden" /> : null}
              <BreadcrumbItem className={index === crumbs.length - 1 ? "min-w-0" : "max-sm:hidden"}>
                {index === crumbs.length - 1 ? (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <CommandPalette pages={pages} entities={entities} onOpen={refresh} />
      <ThemeToggle />
    </header>
  );
}
