import { recordReturn } from "@tbook/services";
import { returnInputSchema } from "@tbook/schemas";
import { parseBody, requireInventoryOrg } from "@/lib/v2/inventory";
import { runV2 } from "@/lib/v2/response";

/** POST — goods came back (refund/exchange): units go back on sale. Idempotent per reference + SKU. */
export async function POST(request: Request) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    const input = await parseBody(request, returnInputSchema);
    return { data: await recordReturn(organizationId, input, "api") };
  });
}
