import { ActionError } from "@tbook/actions";
import { PRODUCT_IMAGE_MAX_BYTES, storeProductImage, type CropRect } from "@tbook/services";
import { jsonError, requireProductWrite } from "@/lib/product-access-server";

/** POST multipart { file, crop? (JSON {x,y,width,height} in source pixels) } → { path } */
export async function POST(request: Request) {
  try {
    const { organizationId } = await requireProductWrite();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw ActionError.validation("Choose an image to upload.");
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) throw ActionError.validation("Images can be at most 15 MB.");
    const crop = parseCrop(form.get("crop"));
    const path = await storeProductImage(organizationId, Buffer.from(await file.arrayBuffer()), crop);
    return Response.json({ path });
  } catch (error) {
    return jsonError(error);
  }
}

function parseCrop(raw: FormDataEntryValue | null): CropRect | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw) as CropRect;
    if ([value.x, value.y, value.width, value.height].every((n) => Number.isFinite(n))) return value;
  } catch {
    // fall through
  }
  throw ActionError.validation("Invalid crop.");
}
