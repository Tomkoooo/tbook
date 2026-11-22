import { ActionError } from "@tbook/actions";
import { getMerchReceiptPdf } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

/** The merch sale's receipt PDF, inline, for printing from the tablet (Share → Print). */
export async function GET(_request: Request, { params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params;
  try {
    let context;
    try {
      context = await requireOrgPermission("sale:create");
    } catch (error) {
      if (!(error instanceof ActionError) || error.status !== 403) throw error;
      context = await requireOrgPermission("booking:manage");
    }
    const receipt = await getMerchReceiptPdf(context.organizationId, saleId);
    if (!receipt) return new Response("This sale has no receipt PDF yet.", { status: 404 });
    return new Response(new Uint8Array(receipt.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${receipt.number.replace(/[^\w.-]+/g, "_")}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ActionError) return new Response(error.message, { status: error.status });
    console.error("[merch receipt pdf]", error);
    return new Response("Could not load the receipt.", { status: 500 });
  }
}
