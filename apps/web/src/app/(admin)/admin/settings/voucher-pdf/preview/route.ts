import { ActionError } from "@tbook/actions";
import { renderVoucherPdfPreview } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

/**
 * Renders a sample ticket in the layout posted by the editor — saved or not —
 * so what an admin sees is exactly what a guest's PDF will look like.
 */
export async function POST(request: Request) {
  try {
    const { organizationId } = await requireOrgPermission("org:update");
    const layout: unknown = await request.json().catch(() => null);
    const pdf = await renderVoucherPdfPreview(organizationId, layout);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ActionError) return new Response(error.message, { status: error.status });
    console.error("[voucher pdf preview]", error);
    return new Response("Could not render the preview.", { status: 500 });
  }
}
