import { attachInvoiceToBooking } from "@tbook/services";
import { adminAttachInvoiceSchema } from "@tbook/schemas";
import { parseInput } from "@tbook/actions";
import { requireOrgPermission } from "@/lib/admin-auth";
import { readJsonBody, runV2 } from "@/lib/v2/response";
import { toBookingDetail } from "@/lib/v2/serialize";

/**
 * v2 — record an invoice issued outside the platform.
 *
 * JSON only (number, no file). The PDF upload path is the console's
 * multipart server action: accepting a base64 PDF in a JSON body would mean
 * holding a 10 MB string in memory per request for no benefit.
 */
export async function PUT(request: Request, context: { params: Promise<{ bookingId: string }> }) {
  return runV2(async () => {
    const { organizationId } = await requireOrgPermission("booking:manage");
    const { bookingId } = await context.params;
    const { invoiceNumber } = parseInput(adminAttachInvoiceSchema, await readJsonBody(request));

    const booking = await attachInvoiceToBooking(organizationId, bookingId, { invoiceNumber });
    return { data: toBookingDetail(booking) };
  });
}
