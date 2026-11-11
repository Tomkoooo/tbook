"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsUpDown,
  BedDouble,
  Bus,
  ChartColumn,
  ListOrdered,
  MessageSquareHeart,
  Database,
  Eye,
  LifeBuoy,
  Mail,
  CalendarDays,
  FolderKanban,
  LayoutDashboard,
  ScanLine,
  ShoppingCart,
  Building2,
  Package,
  Settings,
  Tablet,
  Ticket,
  Users,
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
  /** Permission(s) the page requires, any one of which suffices; null = visible to every member. */
  permission: string | readonly string[] | null;
  /** Extra path prefixes that should also mark this link active. */
  alsoActiveOn?: string[];
  /** Shown only when the organization has been granted this module. */
  module?: string;
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
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: null },
      { href: "/admin/preview", label: "Preview", icon: Eye, permission: "event:read" },
      { href: "/admin/help", label: "Súgó (Help)", icon: LifeBuoy, permission: null },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/admin/sales", label: "Point of sale", icon: ShoppingCart, permission: ["sale:create", "booking:manage"] },
      { href: "/admin/bookings", label: "Bookings", icon: Ticket, permission: "booking:read" },
      { href: "/admin/check-in", label: "Check-in", icon: ScanLine, permission: "voucher:read" },
    ],
  },
  {
    label: "Guests",
    items: [
      { href: "/admin/emails", label: "Emails", icon: Mail, permission: ["email:send", "booking:manage"], module: "event-emails" },
      { href: "/admin/bus", label: "Buses", icon: Bus, permission: ["bus:manage", "bus:board", "booking:manage"], module: "bus-transport" },
      { href: "/admin/waitlist", label: "Waitlist", icon: ListOrdered, permission: ["waitlist:manage", "booking:manage"], module: "waitlist" },
      { href: "/admin/feedback", label: "Feedback", icon: MessageSquareHeart, permission: ["feedback:manage", "event:write"], module: "feedback" },
      { href: "/admin/kiosk", label: "Kiosk", icon: Tablet, permission: ["feedback:kiosk", "feedback:manage", "event:write"], module: "feedback" },
      { href: "/admin/reports", label: "Reports", icon: ChartColumn, permission: "booking:read" },
      { href: "/admin/data", label: "Data", icon: Database, permission: ["list:manage", "event:write"] },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/admin/groups", label: "Event groups", icon: FolderKanban, permission: "group:read" },
      { href: "/admin/events", label: "Events", icon: CalendarDays, permission: "event:read" },
      { href: "/admin/hotels", label: "Hotels", icon: BedDouble, permission: "hotel:read" },
      { href: "/admin/products", label: "Products", icon: Package, permission: ["product:read", "product:write", "event:read"] },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/admin/members", label: "Team", icon: Users, permission: "member:read" },
      { href: "/admin/settings", label: "Settings", icon: Settings, permission: "org:update", alsoActiveOn: ["/admin/integrations"] },
    ],
  },
];

/** Only shown to platform system admins. */
const PLATFORM_ITEMS: NavItem[] = [
  { href: "/admin/organizations", label: "Organizations", icon: Building2, permission: null },
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
        {GROUPS.map((group) => {
          const items = group.items.filter(
            (item) =>
              (!item.module || modules.includes(item.module)) &&
              (!item.permission || [item.permission].flat().some((permission) => granted.has(permission))),
          );
          return items.length === 0 ? null : <NavGroup key={group.label} label={group.label} items={items} pathname={pathname} />;
        })}
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
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : [item.href, ...(item.alsoActiveOn ?? [])].some((prefix) => pathname.startsWith(prefix));
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
}
