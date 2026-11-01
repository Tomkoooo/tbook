import { getStockLevels } from "@tbook/services";
import { requireInventoryOrg } from "@/lib/v2/inventory";
import { runV2, searchParamsToObject } from "@/lib/v2/response";

/** GET ?sku=A,B — stock per SKU (all SKUs when omitted). */
export async function GET(request: Request) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    const raw = searchParamsToObject(request.url).sku;
    const skus = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const levels = await getStockLevels(organizationId, skus);
    return { data: levels, meta: { count: levels.length } };
  });
}
