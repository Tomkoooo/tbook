import { commitReservation } from "@tbook/services";
import { requireInventoryOrg } from "@/lib/v2/inventory";
import { runV2 } from "@/lib/v2/response";

/** POST — the order is paid: held units leave stock. Idempotent. */
export async function POST(request: Request, { params }: { params: Promise<{ reservationId: string }> }) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    return { data: await commitReservation(organizationId, decodeURIComponent((await params).reservationId), "api") };
  });
}
