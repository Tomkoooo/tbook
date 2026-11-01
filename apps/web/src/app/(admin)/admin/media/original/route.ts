import { readProductImageOriginal } from "@tbook/services";
import { jsonError, requireProductWrite } from "@/lib/product-access-server";

/** GET ?path=/media/<hash>.webp — the uncropped original, so the cropper can show the whole picture. */
export async function GET(request: Request) {
  try {
    const { organizationId } = await requireProductWrite();
    const path = new URL(request.url).searchParams.get("path") ?? "";
    const original = await readProductImageOriginal(organizationId, path);
    if (!original) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(original), {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
