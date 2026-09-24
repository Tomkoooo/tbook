import { getCheckoutStatus } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { runV1 } from "@/lib/v1/response";

/**
 * v1 — legacy path alias for GET /checkout/status (same underlying call).
 * Unlike /checkout/status, the legacy handler requires the group API key
 * here too — preserved as-is for byte compatibility, not "fixed" to match
 * the sibling route.
 */
export async function GET(request: Request) {
  return runV1(request, async () => {
    await requireApiKeyGroup(request);
    const url = new URL(request.url);
    const bookingId = url.searchParams.get("bookingId") || "";
    const sessionId = url.searchParams.get("session_id");
    return getCheckoutStatus(bookingId, sessionId);
  });
}
