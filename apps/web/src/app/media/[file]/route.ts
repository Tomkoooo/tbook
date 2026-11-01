import { ensureDbConnection } from "@tbook/db";
import { readPublicProductImage } from "@tbook/services";

/**
 * Public product images: /media/<sha256>.webp. Content-addressed, so a URL
 * always means the same bytes and can be cached forever. Only processed
 * product images are served — ticket assets, invoices and image originals
 * in the same store are never reachable here.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const match = /^([a-f0-9]{64})\.webp$/.exec((await params).file);
  if (!match) return new Response("Not found", { status: 404 });
  await ensureDbConnection();
  const image = await readPublicProductImage(match[1]!);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
