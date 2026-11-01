import { recordSale } from "@tbook/services";
import { directSaleInputSchema } from "@tbook/schemas";
import { parseBody, requireInventoryOrg } from "@/lib/v2/inventory";
import { runV2 } from "@/lib/v2/response";

/** POST — sell outright without a reservation. Idempotent by `reference`. */
export async function POST(request: Request) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    const input = await parseBody(request, directSaleInputSchema);
    const { sale, created } = await recordSale(organizationId, input, "api");
    return { data: sale, meta: { created } };
  });
}
