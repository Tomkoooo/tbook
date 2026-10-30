"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsUpDown,
  BedDouble,
  CalendarDays,
  FolderKanban,
  LayoutDashboard,
  ScanLine,
  Ticket,
  Webhook,
  type LucideIcon,
} from "lucide-react";
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

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The permission the page requires; null = visible to every member. */
  permission: string | null;
}

/**
 * Each link carries the permission its page requires, so the sidebar shows
 * only what this member can actually open — otherwise a Viewer sees
 * "Integrations", clicks it, and gets bounced back to the dashboard with a
 * permission error, which reads as a broken console rather than a
 * deliberate restriction. The pages enforce it regardless; this is the
 * affordance.
 */
const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: null }],
  },
  {
    label: "Sales",
    items: [
      { href: "/admin/bookings", label: "Bookings", icon: Ticket, permission: "booking:read" },
      { href: "/admin/check-in", label: "Check-in", icon: ScanLine, permission: "voucher:read" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/admin/groups", label: "Event groups", icon: FolderKanban, permission: "group:read" },
      { href: "/admin/events", label: "Events", icon: CalendarDays, permission: "event:read" },
      { href: "/admin/hotels", label: "Hotels", icon: BedDouble, permission: "hotel:read" },
    ],
  },
  {
    label: "Settings",
    items: [{ href: "/admin/integrations", label: "Integrations", icon: Webhook, permission: "org:update" }],
  },
];

/**
 * Client component purely so the active link can be marked from the
 * pathname — `usePathname` has no server equivalent.
 */
export function AdminNav({
  organizationName,
  userEmail,
  isSystemAdmin,
  permissions,
}: {
  organizationName: string | null;
  userEmail: string | null;
  isSystemAdmin: boolean;
  /** The acting member's permissions; empty when no org is selected yet. */
  permissions: string[];
}) {
  const pathname = usePathname();
  const granted = new Set(permissions);

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
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.permission || granted.has(item.permission));
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                          <Link href={item.href} aria-current={active ? "page" : undefined}>
                            <item.icon />
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
        })}
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
