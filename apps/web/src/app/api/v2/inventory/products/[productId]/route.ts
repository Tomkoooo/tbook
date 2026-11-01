import { getProduct, saveProduct } from "@tbook/services";
import { productInputSchema } from "@tbook/schemas";
import { parseBody, requireInventoryOrg, withAbsoluteImages, withRelativeImages } from "@/lib/v2/inventory";
import { runV2 } from "@/lib/v2/response";

type Params = { params: Promise<{ productId: string }> };

export async function GET(request: Request, { params }: Params) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    return { data: withAbsoluteImages(await getProduct(organizationId, (await params).productId), request) };
  });
}

/** Full replace. Send existing variants with their `id`; stock is not changed here (use stock adjustments). */
export async function PUT(request: Request, { params }: Params) {
  return runV2(async () => {
    const organizationId = await requireInventoryOrg(request);
    const input = withRelativeImages(await parseBody(request, productInputSchema), request);
    return { data: withAbsoluteImages(await saveProduct(organizationId, (await params).productId, input, "api"), request) };
  });
}
