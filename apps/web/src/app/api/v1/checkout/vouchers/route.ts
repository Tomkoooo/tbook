import { voucherRepository } from "@tbook/db";
import { loadBookingForGuestCheckout, readStoredFile } from "@tbook/services";
import { v1ErrorResponse, V1HttpError } from "@/lib/v1/response";
import { NextResponse } from "next/server";

/**
 * v1 — guest entry/voucher PDF download (no login, bookingId + session_id
 * is the bearer-token pair). All vouchers for a booking share one
 * multi-page PDF (one page per guest) — any row's pdfFileName points at it.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const bookingId = url.searchParams.get("bookingId") || "";
    const sessionId = url.searchParams.get("session_id");

    await loadBookingForGuestCheckout(bookingId, sessionId);
    const [voucher] = await voucherRepository.findByBookingId(bookingId);
    if (!voucher?.pdfFileName) {
      throw new V1HttpError(404, "Entry PDF is not available");
    }
    const pdf = await readStoredFile(voucher.pdfFileName);
    if (!pdf) throw new V1HttpError(404, "Entry PDF is not available");

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="jegy-${bookingId.slice(-8)}.pdf"`,
      },
    });
  } catch (error) {
    return v1ErrorResponse(error, request);
  }
}
