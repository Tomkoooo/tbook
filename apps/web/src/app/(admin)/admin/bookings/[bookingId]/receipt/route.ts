import { ActionError } from "@tbook/actions";
import { getReceiptPdfForOrg } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

/**
 * The walk-in receipt PDF, served inline so the tablet opens it in the
 * browser's PDF viewer, where Share → Print (AirPrint / Mopria) sends it
 * to the network printer. Sellers (sale:create) and anyone who can read
 * bookings may open it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  try {
    let context;
    try {
      context = await requireOrgPermission("sale:create");
    } catch (error) {
      if (!(error instanceof ActionError) || !error.message.includes("permission")) throw error;
      context = await requireOrgPermission("booking:read");
    }
    const receipt = await getReceiptPdfForOrg(context.organizationId, bookingId);
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
    console.error("[receipt pdf]", error);
    return new Response("Could not load the receipt.", { status: 500 });
  }
}
