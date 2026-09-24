import type { ReactNode } from "react";

/**
 * Admin console route group. Phase 5 adds real session/permission gating
 * here (org-scoped RBAC, ported from the legacy resolveTBookAdminAuth
 * pattern) before rendering any admin screen.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="tbook-admin">{children}</div>;
}
