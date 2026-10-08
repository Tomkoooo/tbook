import { markBookingPaidOffline } from "@tbook/services";
import { adminMarkPaidSchema } from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { getSessionUser, requireOrgPermission } from "@/lib/admin-auth";
import { readJsonBody, runV2 } from "@/lib/v2/response";
import { toBookingDetail } from "@/lib/v2/serialize";

/**
 * v2 — record a payment taken outside the platform. Runs the same
 * after-payment pipeline a Stripe webhook does, so the booking ends up with
 * the same entries, invoice and integration side effects.
 */
export async function POST(request: Request, context: { params: Promise<{ bookingId: string }> }) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const { bookingId } = await context.params;
    const user = await getSessionUser();
    const input = parseInput(adminMarkPaidSchema, await readJsonBody(request));

    const booking = await markBookingPaidOffline(organizationId, bookingId, input, { userId: user?.id ?? null });
    return { data: toBookingDetail(booking) };
  });
}
