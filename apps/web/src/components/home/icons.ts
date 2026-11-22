import {
  BarChart3,
  Building2,
  CalendarDays,
  Database,
  Store,
  Eye,
  FolderKanban,
  Hotel,
  LayoutDashboard,
  LifeBuoy,
  ListOrdered,
  Mail,
  MessageSquare,
  Package,
  QrCode,
  Settings,
  ShoppingCart,
  Star,
  Tablet,
  Ticket,
  Users,
  Bus,
  GlassWater,
  type LucideIcon,
} from "lucide-react";
import type { EventToolIconKey } from "@/lib/event-tools";
import type { NavIconKey } from "@/lib/nav-config";

/** Icons for the home page's shortcut buttons (one per event tool). */
const TOOL_ICONS: Partial<Record<EventToolIconKey, LucideIcon>> = {
  bookings: Ticket,
  checkin: QrCode,
  pos: ShoppingCart,
  stand: GlassWater,
  vip: Star,
  hotels: Hotel,
  bus: Bus,
  waitlist: ListOrdered,
  feedback: MessageSquare,
  kiosk: Tablet,
  emails: Mail,
  reports: BarChart3,
  preview: Eye,
};

/** Icons for the org-level page links. */
const NAV_ICONS: Partial<Record<NavIconKey, LucideIcon>> = {
  dashboard: LayoutDashboard,
  help: LifeBuoy,
  groups: FolderKanban,
  events: CalendarDays,
  pos: ShoppingCart,
  stand: GlassWater,
  bookings: Ticket,
  checkin: QrCode,
  products: Package,
  team: Users,
  settings: Settings,
  organizations: Building2,
  merch: Store,
  data: Database,
};

/** Icon for an event tool; a neutral one if the registry gains a key before this map does. */
export function toolIcon(key: EventToolIconKey): LucideIcon {
  return TOOL_ICONS[key] ?? Ticket;
}

/** Icon for an org-level page link, with the same fallback. */
export function navIcon(key: NavIconKey): LucideIcon {
  return NAV_ICONS[key] ?? LayoutDashboard;
}
