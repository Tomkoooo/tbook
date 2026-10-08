"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/check-in", label: "Check-in" },
];

/**
 * Client component purely so the active link can be marked from the
 * pathname — `usePathname` has no server equivalent, and `aria-current`
 * matters more here than shaving a few kB of JS off an admin console.
 */
export function AdminNav({
  organizationName,
  userEmail,
  isSystemAdmin,
}: {
  organizationName: string | null;
  userEmail: string | null;
  isSystemAdmin: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="tbook-admin-bar">
      <Link className="tbook-admin-brand" href="/admin">
        tBook
      </Link>

      <nav className="tbook-admin-nav">
        {LINKS.map((link) => {
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
