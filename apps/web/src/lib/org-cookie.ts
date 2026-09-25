import { cookies } from "next/headers";

/**
 * Ported from the legacy plugin's lib/org-cookie.ts. The literal cookie
 * name/options must match exactly — this is what "the active org" means
 * for a signed-in admin, stored client-side (httpOnly) rather than in the
 * session, so switching orgs doesn't require a full re-auth.
 */
const TBOOK_ACTIVE_ORG_COOKIE = "tbook_active_org";

export async function getActiveOrganizationIdFromCookie(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(TBOOK_ACTIVE_ORG_COOKIE)?.value?.trim();
  return value || null;
}

export function activeOrgCookieOptions(organizationId: string) {
  return {
    name: TBOOK_ACTIVE_ORG_COOKIE,
    value: organizationId,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  };
}

export function clearActiveOrgCookieOptions() {
  return {
    name: TBOOK_ACTIVE_ORG_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
}
