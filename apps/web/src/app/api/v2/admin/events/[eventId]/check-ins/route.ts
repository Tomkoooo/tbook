import { listCheckInRosterForOrg } from "@tbook/services";
import { adminCheckInRosterQuerySchema } from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { requireOrgPermission } from "@/lib/admin-auth";
import { runV2, searchParamsToObject } from "@/lib/v2/response";
import { toVoucherDto } from "@/lib/v2/serialize";

/** v2 — the door roster for one event: who's expected, who's already scanned in. */
export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("voucher:read");
    const { eventId } = await context.params;
    const { page, pageSize, ...filter } = parseInput(adminCheckInRosterQuerySchema, searchParamsToObject(request.url));

    const roster = await listCheckInRosterForOrg(organizationId, eventId, filter, { page, pageSize });

    return {
      data: roster.vouchers.map(toVoucherDto),
      meta: {
        event: roster.event,
        page: roster.page,
        pageSize: roster.pageSize,
        total: roster.total,
        pageCount: roster.pageCount,
        statusTotals: roster.statusTotals,
        checkedIn: roster.checkedIn,
        outstanding: roster.outstanding,
      },
    };
  });
}
