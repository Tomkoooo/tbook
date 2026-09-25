import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/admin-auth";

/**
 * Admin console route group. Gates on a signed-in session; a full
 * org-picker UX (matching legacy's TBookAdminHomeResolver) is a later
 * frontend-phase concern — this just enforces "you must be signed in",
 * plus a minimal "no organization yet" state for a session with no active
 * org and no system-admin access.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/signin?callbackUrl=/admin");
  }

  if (!user.isSystemAdmin && user.organizationIds.length === 0) {
    return (
      <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>No organization access</h1>
        <p>Your account isn&apos;t a member of any organization yet. Ask an org admin to invite you.</p>
      </main>
    );
  }

  return <div className="tbook-admin">{children}</div>;
}
