import { listStockMovements } from "@tbook/services";
import { requireInventoryOrg } from "@/lib/v2/inventory";
import { runV2, searchParamsToObject } from "@/lib/v2/response";

/** GET ?sku=&limit= — the stock movement log, newest first. */
export async function GET(request: Request) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    const q = searchParamsToObject(request.url);
    const movements = await listStockMovements(organizationId, { sku: q.sku || undefined, limit: q.limit ? Number(q.limit) : undefined });
    return { data: movements, meta: { count: movements.length } };
  });
}
