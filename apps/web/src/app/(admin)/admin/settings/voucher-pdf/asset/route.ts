import { readVoucherPdfAsset } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

/** Serves an uploaded ticket picture back to the editor, only to members of the organization that owns it. */
export async function GET(request: Request) {
  try {
    const { organizationId } = await requireOrgPermission("org:update");
    const url = new URL(request.url).searchParams.get("url") ?? "";
    const asset = await readVoucherPdfAsset(organizationId, url);
    if (!asset) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(asset.bytes), {
      headers: { "Content-Type": asset.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
