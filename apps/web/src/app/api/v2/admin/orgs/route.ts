import { listOrganizationsForUser } from "@tbook/services";
import { organizationRepository } from "@tbook/db";
import { ActionError } from "@tbook/actions";
import { getSessionUser } from "@/lib/admin-auth";
import { getActiveOrganizationIdFromCookie } from "@/lib/org-cookie";
import { runV2 } from "@/lib/v2/response";

/**
 * v2 — the orgs this session may act as, for the console's org picker.
 * Gated on a session only (not an org permission), since this is what a
 * user calls *before* having an active org at all.
 *
 * A system admin sees every organization: that's the legacy behavior
 * (requireOrgPermission bypasses permission checks for them), and without
 * it a platform admin with no membership anywhere could never reach a
 * tenant's console to support them.
 */
export async function GET() {
  return runV2(async () => {
    const user = await getSessionUser();
    if (!user) throw ActionError.unauthorized();

    const organizations = user.isSystemAdmin
      ? (await organizationRepository.listAll()).map((org) => ({ id: String(org._id), name: org.name, slug: org.slug }))
      : await listOrganizationsForUser(user.id);

    const activeOrganizationId = user.activeOrganizationId ?? (await getActiveOrganizationIdFromCookie());

    return {
      data: organizations,
      meta: { activeOrganizationId: activeOrganizationId ?? null, isSystemAdmin: user.isSystemAdmin },
    };
  });
}
