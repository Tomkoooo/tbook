import { adjustStock } from "@tbook/services";
import { stockAdjustmentInputSchema } from "@tbook/schemas";
import { parseBody, requireInventoryOrg } from "@/lib/v2/inventory";
import { runV2 } from "@/lib/v2/response";

/** POST — goods in, stock count or write-off. Give `setOnHand` or `delta`. */
export async function POST(request: Request) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    const input = await parseBody(request, stockAdjustmentInputSchema);
    return { data: await adjustStock(organizationId, input, "api") };
  });
}
