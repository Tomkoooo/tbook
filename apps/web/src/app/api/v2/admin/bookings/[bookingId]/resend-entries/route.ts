import { resendVoucherEmailAsAdmin } from "@tbook/services";
import { adminResendEntriesSchema } from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { requireOrgPermission } from "@/lib/admin-auth";
import { readJsonBody, runV2 } from "@/lib/v2/response";

/**
 * v2 — re-send a booking's entry PDF. The single most common support
 * request this console exists to serve ("I lost the email"). Gated on
 * voucher:manage rather than booking:read: it sends mail on the org's
 * behalf, which is a write-shaped action.
 */
export async function POST(request: Request, context: { params: Promise<{ bookingId: string }> }) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("voucher:manage");
    const { bookingId } = await context.params;
    const input = parseInput(adminResendEntriesSchema, await readJsonBody(request));

    const result = await resendVoucherEmailAsAdmin(organizationId, bookingId, input);
    return { data: result };
  });
}
