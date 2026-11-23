import {
  BedDouble,
  Building2,
  Bus,
  CalendarDays,
  ChartColumn,
  Database,
  Eye,
  FolderKanban,
  LayoutDashboard,
  LifeBuoy,
  ListOrdered,
  Mail,
  MessageSquareHeart,
  Package,
  ScanLine,
  Settings,
  ShoppingCart,
  Star,
  ShoppingBag,
  Store,
  Tablet,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { EventToolIconKey, ToolLink } from "@/lib/event-tools";
import type { NavIconKey } from "@/lib/nav-config";

/** Lucide icons for the navigation data in lib/nav-config.ts and lib/event-tools.ts. */
export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  help: LifeBuoy,
  groups: FolderKanban,
  events: CalendarDays,
  pos: ShoppingCart,
  stand: Store,
  bookings: Ticket,
  checkin: ScanLine,
  products: Package,
  team: Users,
  settings: Settings,
  organizations: Building2,
  merch: ShoppingBag,
  reports: ChartColumn,
  data: Database,
};

export const EVENT_TOOL_ICONS: Record<EventToolIconKey, LucideIcon> = {
  bookings: Ticket,
  checkin: ScanLine,
  pos: ShoppingCart,
  stand: Store,
  vip: Star,
  hotels: BedDouble,
  bus: Bus,
  waitlist: ListOrdered,
  feedback: MessageSquareHeart,
  kiosk: Tablet,
  emails: Mail,
  reports: ChartColumn,
  preview: Eye,
};

/** Icons for workspace tabs / contextual sidebar links (an event's tools plus its overview). */
export const TOOL_LINK_ICONS: Record<ToolLink["icon"], LucideIcon> = { ...EVENT_TOOL_ICONS, overview: LayoutDashboard, events: CalendarDays };
