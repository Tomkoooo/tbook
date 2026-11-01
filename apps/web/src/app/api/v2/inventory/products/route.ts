import { listProducts, saveProduct } from "@tbook/services";
import { productInputSchema, productStatuses, salesChannels, type ProductStatus, type SalesChannel } from "@tbook/schemas";
import { parseBody, requireInventoryOrg, withAbsoluteImages, withRelativeImages } from "@/lib/v2/inventory";
import { runV2, searchParamsToObject } from "@/lib/v2/response";

/**
 * GET  — products. Defaults to what the webshop should list: status=active,
 *        channel=webshop. `status=all` / `channel=all` widen it.
 * POST — create a product (with its variants and initial stock).
 */
export async function GET(request: Request) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    const q = searchParamsToObject(request.url);
    const status = q.status === "all" ? undefined : (productStatuses as readonly string[]).includes(q.status ?? "") ? (q.status as ProductStatus) : "active";
    const channel = q.channel === "all" ? undefined : (salesChannels as readonly string[]).includes(q.channel ?? "") ? (q.channel as SalesChannel) : "webshop";
    const products = await listProducts(organizationId, {
      status,
      channel,
      category: q.category || undefined,
      search: q.search || undefined,
      inStock: q.inStock === "true" || q.inStock === "1",
    });
    return { data: products.map((p) => withAbsoluteImages(p, request)), meta: { count: products.length } };
  });
}

export async function POST(request: Request) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    const input = withRelativeImages(await parseBody(request, productInputSchema), request);
    return { data: withAbsoluteImages(await saveProduct(organizationId, null, input, "api"), request) };
  });
}
