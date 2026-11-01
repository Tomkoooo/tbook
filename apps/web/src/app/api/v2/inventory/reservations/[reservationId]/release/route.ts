import { releaseReservation } from "@tbook/services";
import { requireInventoryOrg } from "@/lib/v2/inventory";
import { runV2 } from "@/lib/v2/response";

/** POST — checkout abandoned or order cancelled before payment: units go back on sale. Idempotent. */
export async function POST(request: Request, { params }: { params: Promise<{ reservationId: string }> }) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    return { data: await releaseReservation(organizationId, decodeURIComponent((await params).reservationId), "api") };
  });
}
