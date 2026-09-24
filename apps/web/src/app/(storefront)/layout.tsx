import type { ReactNode } from "react";

/**
 * Public, SEO-relevant storefront route group (event listing, booking
 * wizard, success page). Phase 6 fills this in; kept separate from the
 * (admin) group so each can evolve its own layout/chrome independently
 * while sharing @tbook/ui underneath.
 */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return <div className="tbook-storefront">{children}</div>;
}
