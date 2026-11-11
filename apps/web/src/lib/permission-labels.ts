import type { Permission } from "@tbook/schemas";

/** Human labels for the permission catalog, grouped the way the role editor shows them. */
export const PERMISSION_GROUPS: Array<{ label: string; permissions: Array<{ key: Permission; label: string }> }> = [
  {
    label: "Organization",
    permissions: [
      { key: "org:read", label: "View organization" },
      { key: "org:update", label: "Change settings and integrations" },
      { key: "stats:read", label: "View statistics" },
    ],
  },
  {
    label: "Team",
    permissions: [
      { key: "member:read", label: "View members" },
      { key: "member:invite", label: "Invite members" },
      { key: "member:manage", label: "Change members' roles, remove members" },
      { key: "role:read", label: "View roles" },
      { key: "role:manage", label: "Create and edit roles" },
    ],
  },
  {
    label: "Catalog",
    permissions: [
      { key: "group:read", label: "View event groups" },
      { key: "group:write", label: "Edit event groups" },
      { key: "group:apiKey", label: "Manage group API keys" },
      { key: "event:read", label: "View events" },
      { key: "event:write", label: "Edit events" },
      { key: "hotel:read", label: "View hotels" },
      { key: "hotel:write", label: "Edit hotels" },
      { key: "product:read", label: "View products and stock" },
      { key: "product:write", label: "Edit products, adjust stock" },
    ],
  },
  {
    label: "Sales and bookings",
    permissions: [
      { key: "booking:read", label: "View bookings" },
      { key: "booking:export", label: "Export bookings" },
      { key: "booking:manage", label: "Edit, cancel and register bookings" },
      { key: "sale:create", label: "Sell at the point of sale" },
    ],
  },
  {
    label: "Check-in",
    permissions: [
      { key: "voucher:read", label: "View entries" },
      { key: "voucher:scan", label: "Scan entries at the door" },
      { key: "voucher:manage", label: "Undo check-ins, re-send tickets" },
    ],
  },
  {
    label: "Modules and data",
    permissions: [
      { key: "module:manage", label: "Switch modules on for groups and events" },
      { key: "list:manage", label: "Import spreadsheets, manage data lists" },
      { key: "email:send", label: "Send event emails" },
      { key: "bus:manage", label: "Manage buses, captain links and boarding" },
      { key: "waitlist:manage", label: "Manage the waitlist" },
      { key: "feedback:manage", label: "Surveys, kiosk ratings and their results" },
    ],
  },
];
