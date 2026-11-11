import { z } from "zod";

/** Ported from the legacy plugin's lib/permissions.ts — fixed RBAC catalog. */
export const TBOOK_PERMISSIONS = [
  "org:read",
  "org:update",
  "member:read",
  "member:invite",
  "member:manage",
  "role:read",
  "role:manage",
  "group:read",
  "group:write",
  "group:apiKey",
  "event:read",
  "event:write",
  "hotel:read",
  "hotel:write",
  "product:read",
  "product:write",
  "booking:read",
  "booking:export",
  "booking:manage",
  "sale:create",
  "voucher:read",
  "voucher:scan",
  "voucher:manage",
  "stats:read",
  /** Switch feature modules on/off for groups and events (inside the org entitlement). Falls back to event:write. */
  "module:manage",
  /** Upload spreadsheets, manage data lists. Falls back to event:write. */
  "list:manage",
  /** Send event emails (campaigns, reminders). Falls back to booking:manage. */
  "email:send",
  /** Manage bus routes, captain links and boarding. Falls back to booking:manage. */
  "bus:manage",
  /** Bus captain: see the buses and mark passengers' boarding (no route editing). Falls back to bus:manage, booking:manage. */
  "bus:board",
  /** See and manage an event's waitlist. Falls back to booking:manage. */
  "waitlist:manage",
  /** Create surveys, kiosk links, read feedback results. Falls back to event:write. */
  "feedback:manage",
  /** Run the rating kiosk on a venue tablet while signed in. Falls back to feedback:manage, event:write. */
  "feedback:kiosk",
] as const;

export const permissionSchema = z.enum(TBOOK_PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

export const TBOOK_VIEWER_PERMISSIONS: Permission[] = [
  "org:read",
  "member:read",
  "role:read",
  "group:read",
  "event:read",
  "hotel:read",
  "product:read",
  "booking:read",
  "voucher:read",
  "stats:read",
];

export const TBOOK_OWNER_PERMISSIONS: Permission[] = [...TBOOK_PERMISSIONS];

export function isTBookPermission(value: string): value is Permission {
  return (TBOOK_PERMISSIONS as readonly string[]).includes(value);
}
