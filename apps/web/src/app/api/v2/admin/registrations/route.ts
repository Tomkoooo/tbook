import { createAdminRegistration, listRegistrableEvents, previewAdminRegistration } from "@tbook/services";
import { adminCreateRegistrationSchema } from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { getSessionUser, requireOrgPermission } from "@/lib/admin-auth";
import { readJsonBody, runV2, searchParamsToObject } from "@/lib/v2/response";
import { toBookingDetail } from "@/lib/v2/serialize";

/**
 * v2 — events an admin may register into, with the registration shape the
 * caller needs in order to build the right attendee payload (individual vs
 * team, fixed roster size vs a limit).
 *
 * Includes closed-sales, archived and sold-out events: registering into
 * exactly those is what the manual path is for.
 */
export async function GET(request: Request) {
  // Explicit `unknown`: this handler answers either a preview or a list,
  // and inference would otherwise pin the type to whichever branch is first.
  return runV2<unknown>(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const params = searchParamsToObject(request.url);

    // With ?eventId=&guests= it answers a price preview instead, so a
    // client can show the total before committing.
    if (params.eventId) {
      const preview = await previewAdminRegistration(organizationId, {
        eventId: params.eventId,
        guests: Math.max(Number(params.guests ?? 1) || 1, 1),
        overrides: { allowClosedSales: true, allowInactiveEvent: true },
      });
      return { data: preview };
    }

    return { data: await listRegistrableEvents(organizationId) };
  });
}

/** v2 — create a registration by hand, optionally already paid. */
export async function POST(request: Request) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const user = await getSessionUser();
    const input = parseInput(adminCreateRegistrationSchema, await readJsonBody(request));

    const { booking, finalized } = await createAdminRegistration(organizationId, input, { userId: user?.id ?? null });
    return { data: toBookingDetail(booking), meta: { finalized } };
  });
}
