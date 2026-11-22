"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
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
  SidebarRail,
} from "@/components/ui/sidebar";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import { NAV_GROUPS, PLATFORM_ITEMS, filterNavGroups, isNavItemActive, type NavItem } from "@/lib/nav-config";

/**
 * The sidebar is deliberately small: only global pages. Each link carries
 * the permission its page requires and, for feature modules, the module that
 * must be granted to the organization (see lib/nav-config.ts), so a member
 * sees only what they can really open. Tools that belong to one event
 * (hotels, buses, waitlist, emails, ...) are reached from that event's page.
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
