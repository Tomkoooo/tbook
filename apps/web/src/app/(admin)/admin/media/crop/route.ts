import { ActionError } from "@tbook/actions";
import { recropProductImage, type CropRect } from "@tbook/services";
import { jsonError, requireProductWrite } from "@/lib/product-access-server";

/** POST JSON { path, crop } → { path } — re-crops an uploaded image from its original. */
export async function POST(request: Request) {
  try {
    const { organizationId } = await requireProductWrite();
    const body = (await request.json().catch(() => null)) as { path?: string; crop?: CropRect } | null;
    const crop = body?.crop;
    if (!body?.path || !crop || ![crop.x, crop.y, crop.width, crop.height].every((n) => Number.isFinite(n))) {
      throw ActionError.validation("Invalid crop.");
    }
    return Response.json({ path: await recropProductImage(organizationId, body.path, crop) });
  } catch (error) {
    return jsonError(error);
  }
}
