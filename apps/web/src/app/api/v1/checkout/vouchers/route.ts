import { loadBookingForGuestCheckout, renderVoucherPdfForBooking } from "@tbook/services";
import { v1ErrorResponse, V1HttpError } from "@/lib/v1/response";
import { NextResponse } from "next/server";

/**
 * v1 — guest entry/voucher PDF download (no login, bookingId + session_id
 * is the bearer-token pair). One multi-page PDF (a page per guest),
 * rendered on demand from the booking — nothing is stored.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const bookingId = url.searchParams.get("bookingId") || "";
    const sessionId = url.searchParams.get("session_id");

    await loadBookingForGuestCheckout(bookingId, sessionId);
    const rendered = await renderVoucherPdfForBooking(bookingId);
    if (!rendered) throw new V1HttpError(404, "Entry PDF is not available");

    return new NextResponse(new Uint8Array(rendered.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="jegy-${bookingId.slice(-8)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return v1ErrorResponse(error, request);
  }
}
