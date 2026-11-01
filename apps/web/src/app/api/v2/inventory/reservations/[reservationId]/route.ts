import { getReservation } from "@tbook/services";
import { requireInventoryOrg } from "@/lib/v2/inventory";
import { runV2 } from "@/lib/v2/response";

/** GET — a reservation by its id or by your reference. */
export async function GET(request: Request, { params }: { params: Promise<{ reservationId: string }> }) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    return { data: await getReservation(organizationId, decodeURIComponent((await params).reservationId)) };
  });
}
