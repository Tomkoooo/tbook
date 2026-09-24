import { getCheckoutStatus } from "@tbook/services";
import { runV1, V1HttpError } from "@/lib/v1/response";

/** v1 — guest-facing checkout status poll (no login, bookingId + session_id is the bearer-token pair). */
export async function GET(request: Request) {
  return runV1(request, async () => {
    const url = new URL(request.url);
    const bookingId = url.searchParams.get("bookingId") || "";
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) {
      throw new V1HttpError(400, "session_id kötelező");
    }
    return getCheckoutStatus(bookingId, sessionId);
  });
}
