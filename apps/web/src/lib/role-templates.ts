import type { Permission } from "@tbook/schemas";

/**
 * Starting points for the role editor: the jobs an event team usually
 * hands out. Picking one only fills the form; the role is an ordinary
 * custom role afterwards and can be changed freely.
 */
export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "door",
    name: "Beléptető",
    description: "Scans tickets at the entrance, searches guests by name or ID",
    permissions: ["event:read", "booking:read", "voucher:read", "voucher:scan"],
  },
  {
    key: "captain",
    name: "Buszkapitány",
    description: "Sees the buses and marks who boarded, outbound and return",
    permissions: ["event:read", "bus:board"],
  },
  {
    key: "kiosk",
    name: "Kioszk",
    description: "Runs the rating kiosk on a venue tablet",
    permissions: ["event:read", "feedback:kiosk"],
  },
  {
    key: "organizer",
    name: "Szervező",
    description: "Runs the event day to day: guests, buses, emails, waitlist, check-in",
    permissions: [
      "org:read",
      "stats:read",
      "member:read",
      "group:read",
      "event:read",
      "booking:read",
      "booking:export",
      "booking:manage",
      "voucher:read",
      "voucher:scan",
      "voucher:manage",
      "email:send",
      "bus:manage",
      "bus:board",
      "waitlist:manage",
      "feedback:manage",
      "feedback:kiosk",
    ],
  },
];
