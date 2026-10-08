import { revertCheckInAsAdmin } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";
import { runV2 } from "@/lib/v2/response";
import { toVoucherDto } from "@/lib/v2/serialize";

/**
 * v2 — undo an accidental check-in. Gated on voucher:manage, deliberately
 * stricter than the voucher:scan needed to check someone in: scanning is a
 * door-staff action, undoing one is a supervisor action.
 */
export async function POST(_request: Request, context: { params: Promise<{ voucherId: string }> }) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("voucher:manage");
    const { voucherId } = await context.params;

    const voucher = await revertCheckInAsAdmin(organizationId, voucherId);
    return { data: toVoucherDto(voucher) };
  });
}
