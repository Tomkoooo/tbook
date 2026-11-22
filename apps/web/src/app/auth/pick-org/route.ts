import { listOrganizationsForUser } from "@tbook/services";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/admin-auth";
import { activeOrgCookieOptions } from "@/lib/org-cookie";

/**
 * Remembers the organization for a signed-in user who belongs to exactly one,
 * then returns to the home page. A Server Component can't write cookies, so
 * `/` redirects here instead of asking the user to pick from a list of one.
 *
 * It takes no input: the organization is derived from the session's own
 * memberships (never from the URL), so it can only ever select an org the
 * user is already an active member of. The `?org=auto` marker on the way
 * back tells the home page not to try again if the cookie didn't stick
 * (cookies blocked), which would otherwise loop.
 */
export const dynamic = "force-dynamic";

function back(location: string, cookie?: ReturnType<typeof activeOrgCookieOptions>): NextResponse {
  // A relative Location, so it works behind a proxy that rewrites the host.
  const response = new NextResponse(null, { status: 307, headers: { Location: location } });
  if (cookie) response.cookies.set(cookie);
  return response;
}

export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return back("/auth/signin?callbackUrl=/");
  if (user.isSystemAdmin) return back("/");

  const organizations = await listOrganizationsForUser(user.id).catch(() => []);
  const sole = organizations.length === 1 ? organizations[0]! : null;
  return back("/?org=auto", sole ? activeOrgCookieOptions(sole.id) : undefined);
}
