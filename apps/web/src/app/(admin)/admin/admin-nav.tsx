"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NAV_ICONS, TOOL_LINK_ICONS } from "@/components/shell/nav-icons";
import { useShellEntities } from "@/components/shell/use-shell-entities";
import { useWorkspace } from "@/components/shell/workspace-store";
import { Skeleton } from "@/components/ui/skeleton";
import { routeContext } from "@/lib/event-routes";
import { NAV_GROUPS, PLATFORM_ITEMS, filterNavGroups, isNavItemActive, isTabActive, type NavItem } from "@/lib/nav-config";

/**
 * The sidebar: organization pages and stations, plus a CONTEXTUAL section
 * while the path is inside an event or event group — that workspace's tools
 * (the same filtered list as its tabs, registered by the workspace layout).
 * Each org link carries the permission its page requires and, for feature
 * modules, the module that must be granted to the organization (see
 * lib/nav-config.ts), so a member sees only what they can really open.
 *
 * Client component purely so the active link can be marked from the
 * pathname — `usePathname` has no server equivalent.
 */
export function AdminNav({
  organizationName,
  userEmail,
  isSystemAdmin,
  permissions,
  modules = [],
}: {
  organizationName: string | null;
  userEmail: string | null;
  isSystemAdmin: boolean;
  /** The acting member's permissions; empty when no org is selected yet. */
  permissions: string[];
  /** Modules granted to the active organization. */
  modules?: string[];
}) {
  const pathname = usePathname();
  const groups = filterNavGroups(NAV_GROUPS, { permissions, modules });
  const context = routeContext(pathname);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg text-sm font-semibold">
                    {(organizationName ?? "t").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{organizationName ?? "No organization"}</span>
                    <span className="truncate text-xs">tBook{isSystemAdmin ? " · system admin" : ""}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" align="start">
                <DropdownMenuItem asChild>
                  <Link href="/admin/select-org">Switch organization</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/admin/device-link">Sign in another device (QR)</Link>
                </DropdownMenuItem>
                {isSystemAdmin ? (
                  <DropdownMenuItem asChild>
                    <Link href="/admin/organizations">Manage all organizations</Link>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {context.kind !== "org" ? <ContextSection pathname={pathname} /> : null}
        {groups.map((group) => (
          <NavGroup key={group.label} label={group.label} items={group.items} pathname={pathname} />
        ))}
        {isSystemAdmin ? <NavGroup label="Platform" items={PLATFORM_ITEMS} pathname={pathname} /> : null}
      </SidebarContent>

      <SidebarFooter>
        <p className="text-muted-foreground truncate px-2 text-xs group-data-[collapsible=icon]:hidden">
          {userEmail}
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function NavGroup({ label, items, pathname }: { label: string; items: NavItem[]; pathname: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = isNavItemActive(item, pathname);
            const Icon = NAV_ICONS[item.icon];
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                  <Link href={item.href} aria-current={active ? "page" : undefined}>
                    <Icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** The event's (or group's) tools: titled with its name, with a way back to the list. */
function ContextSection({ pathname }: { pathname: string }) {
  const context = routeContext(pathname);
  const kind = context.kind === "group" ? "group" : "event";
  const id = context.kind === "event" ? context.eventId : context.kind === "group" ? context.groupId : null;
  const workspace = useWorkspace(kind, id);
  // Until the workspace layout has registered itself (first paint), look the name up (cached, shared).
  const { entities } = useShellEntities(id !== null && !workspace);
  const lookedUp = kind === "event" ? entities.events.find((event) => event.id === id)?.name : entities.groups.find((group) => group.id === id)?.name;
  const name = workspace?.name ?? lookedUp ?? null;
  const back = kind === "event" ? { href: "/admin/events", label: "All events" } : { href: "/admin/groups", label: "All event groups" };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{name ?? <Skeleton className="h-4 w-28" />}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={back.label} className="text-muted-foreground">
              <Link href={back.href}>
                <ChevronLeft />
                <span>{back.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {workspace
            ? workspace.links.map((link, index) => {
                const active = isTabActive({ href: link.href, exact: index === 0 }, pathname);
                const Icon = TOOL_LINK_ICONS[link.icon];
                return (
                  <SidebarMenuItem key={link.key}>
                    <SidebarMenuButton asChild isActive={active} tooltip={link.label}>
                      <Link href={link.href} aria-current={active ? "page" : undefined}>
                        <Icon />
                        <span>{link.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })
            : [0, 1, 2].map((index) => (
                <SidebarMenuItem key={index}>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
