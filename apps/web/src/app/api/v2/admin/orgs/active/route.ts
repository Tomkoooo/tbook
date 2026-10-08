import { assertUserOrganizationAccess } from "@tbook/services";
import { adminSetActiveOrgSchema } from "@tbook/schemas";
import { ActionError, parseInput } from "@tbook/actions";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/admin-auth";
import { activeOrgCookieOptions, clearActiveOrgCookieOptions } from "@/lib/org-cookie";
import { readJsonBody, runV2 } from "@/lib/v2/response";

/**
 * v2 — switch the console's active organization. The access check runs
 * server-side via assertUserOrganizationAccess before the cookie is
 * written, so setting the cookie can never itself grant access to an org
 * the user isn't a member of (every read also re-resolves permissions
 * against it on each request).
 */
export async function POST(request: Request) {
  return runV2(async () => {
    const user = await getSessionUser();
    if (!user) throw ActionError.unauthorized();

    const { organizationId } = parseInput(adminSetActiveOrgSchema, await readJsonBody(request));
    await assertUserOrganizationAccess(user.id, organizationId, { isSystemAdmin: user.isSystemAdmin });

    (await cookies()).set(activeOrgCookieOptions(organizationId));
    return { data: { activeOrganizationId: organizationId } };
  });
}

/** v2 — leave the console's org context (back to the picker). */
export async function DELETE() {
  return runV2(async () => {
    const user = await getSessionUser();
    if (!user) throw ActionError.unauthorized();

    (await cookies()).set(clearActiveOrgCookieOptions());
    return { data: { activeOrganizationId: null } };
  });
}
