import { createBookingWithCheckout, createMultiBookingWithCheckout } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1 } from "@/lib/v1/response";

/**
 * v1 — byte-compatible with the legacy plugin's public POST /bookings.
 * A body with an `entries` array books several events in one Stripe
 * checkout (multi-event); otherwise it's a single-event booking.
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:bookings", 20);
    const body = await request.json();
    if (Array.isArray(body?.entries)) {
      return createMultiBookingWithCheckout(body, { groupId });
    }
    return createBookingWithCheckout(body, { groupId });
  });
}
