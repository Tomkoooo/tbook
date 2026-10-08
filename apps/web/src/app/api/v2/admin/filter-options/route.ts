import { listBookingFilterOptions } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";
import { runV2 } from "@/lib/v2/response";

/** v2 — group/event/hotel options for the console's filter controls. */
export async function GET() {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("booking:read");
    return { data: await listBookingFilterOptions(organizationId) };
  });
}
