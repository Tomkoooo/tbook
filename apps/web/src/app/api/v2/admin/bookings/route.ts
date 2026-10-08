import { listBookingsForOrg } from "@tbook/services";
import { adminBookingListQuerySchema } from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { requireOrgPermission } from "@/lib/admin-auth";
import { runV2, searchParamsToObject } from "@/lib/v2/response";
import { toBookingListItem } from "@/lib/v2/serialize";

/**
 * v2 — the admin booking table. Org scope comes from the session's active
 * organization (never from a client-supplied id), so a filter param can't
 * be used to read another tenant's bookings.
 */
export async function GET(request: Request) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("booking:read");
    const query = parseInput(adminBookingListQuerySchema, searchParamsToObject(request.url));

    const result = await listBookingsForOrg(organizationId, query);

    return {
      data: result.bookings.map(toBookingListItem),
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        pageCount: result.pageCount,
        statusTotals: result.statusTotals,
        grandTotalHuf: result.grandTotalHuf,
      },
    };
  });
}
