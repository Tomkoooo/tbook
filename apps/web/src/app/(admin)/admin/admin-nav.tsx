"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Each link carries the permission its page requires, so the nav shows
 * only what this member can actually open — otherwise a Viewer sees
 * "Integrations", clicks it, and gets bounced back to the dashboard with a
 * permission error, which reads as a broken console rather than a
 * deliberate restriction. The pages enforce it regardless; this is the
 * affordance.
 */
const LINKS = [
  { href: "/admin", label: "Dashboard", permission: null },
  { href: "/admin/bookings", label: "Bookings", permission: "booking:read" },
  { href: "/admin/check-in", label: "Check-in", permission: "voucher:read" },
  { href: "/admin/integrations", label: "Integrations", permission: "org:update" },
] as const;

/**
 * Client component purely so the active link can be marked from the
 * pathname — `usePathname` has no server equivalent, and `aria-current`
 * matters more here than shaving a few kB of JS off an admin console.
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
  const visible = LINKS.filter((link) => !link.permission || granted.has(link.permission));

  return (
    <div className="tbook-admin-bar">
      <Link className="tbook-admin-brand" href="/admin">
        tBook
      </Link>

      <nav className="tbook-admin-nav">
        {visible.map((link) => {
          const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
          return (
            <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="tbook-admin-bar-end">
        {organizationName ? (
          <>
            <span>{organizationName}</span>
            <Link className="tbook-btn tbook-btn-ghost tbook-btn-sm" href="/admin/select-org">
              Switch
            </Link>
          </>
        ) : (
          <Link className="tbook-btn tbook-btn-secondary tbook-btn-sm" href="/admin/select-org">
            Select organization
          </Link>
        )}
        {isSystemAdmin ? <span className="tbook-badge tbook-badge-info">System admin</span> : null}
        <span className="tbook-faint">{userEmail}</span>
      </div>
    </div>
  );
}
