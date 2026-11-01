import { ActionError } from "@tbook/actions";
import { storeVoucherPdfAsset } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

/** Stores a picture for the ticket PDF (logo, banner, background) and returns its URL. */
export async function POST(request: Request) {
  try {
    const { organizationId } = await requireOrgPermission("org:update");
    const file = (await request.formData().catch(() => null))?.get("file");
    if (!(file instanceof File)) return Response.json({ message: "Choose an image to upload." }, { status: 400 });
    const { url } = await storeVoucherPdfAsset(organizationId, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ url });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ message: error.message }, { status: error.status });
    console.error("[voucher pdf upload]", error);
    return Response.json({ message: "Could not upload the image." }, { status: 500 });
  }
}
