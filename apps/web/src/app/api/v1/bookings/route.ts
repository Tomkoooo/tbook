import { createBookingWithCheckout } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 — byte-compatible with the legacy plugin's public POST /bookings.
 * Same multi-event caveat as /quote — an `entries` array body gets a 501,
 * this rewrite's booking-service.ts only has the single-event path.
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:bookings", 20);
    const body = await request.json();
    if (Array.isArray(body?.entries)) {
      throw new V1HttpError(501, "Multi-event booking is not yet supported.");
    }
    return createBookingWithCheckout(body, { groupId });
  });
}
