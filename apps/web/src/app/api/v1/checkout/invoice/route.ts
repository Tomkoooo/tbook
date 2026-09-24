import { loadBookingForGuestCheckout, readStoredFile } from "@tbook/services";
import { v1ErrorResponse, V1HttpError } from "@/lib/v1/response";
import { NextResponse } from "next/server";

/** v1 — guest invoice PDF download (no login, bookingId + session_id is the bearer-token pair). */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const bookingId = url.searchParams.get("bookingId") || "";
    const sessionId = url.searchParams.get("session_id");

    const booking = await loadBookingForGuestCheckout(bookingId, sessionId);
    if (booking.invoiceStatus !== "issued" || !booking.invoicePdfFileName) {
      throw new V1HttpError(404, "Invoice PDF is not available");
    }
    const pdf = await readStoredFile(booking.invoicePdfFileName);
    if (!pdf) throw new V1HttpError(404, "Invoice PDF is not available");

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="szamla-${bookingId.slice(-8)}.pdf"`,
      },
    });
  } catch (error) {
    return v1ErrorResponse(error, request);
  }
}
