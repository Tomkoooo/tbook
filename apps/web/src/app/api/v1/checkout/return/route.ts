import { getCheckoutStatus } from "@tbook/services";
import { NextResponse } from "next/server";

/**
 * v1 — legacy Stripe return URL: always redirect to this host's success
 * page. Finalization actually happens via the webhook or the /checkout/
 * status poll from the success page itself — this route just best-effort
 * nudges finalization along before redirecting, exactly like the legacy
 * handleCheckoutReturn.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const bookingId = url.searchParams.get("bookingId") || "";
  const sessionId = url.searchParams.get("session_id");
  const cancelled = url.searchParams.get("cancelled") === "1";

  if (!cancelled && bookingId && sessionId) {
    try {
      await getCheckoutStatus(bookingId, sessionId);
    } catch {
      // Still redirect — the success page polls / shows an error state.
    }
  }

  const target = new URL("/book/success", url.origin);
  if (bookingId) target.searchParams.set("bookingId", bookingId);
  if (sessionId) target.searchParams.set("session_id", sessionId);
  if (cancelled) target.searchParams.set("cancelled", "1");
  return NextResponse.redirect(target, 302);
}
