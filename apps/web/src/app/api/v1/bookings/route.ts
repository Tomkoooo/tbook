import { createBookingWithCheckout, createMultiBookingWithCheckout, createTestBookingWithCheckout, previewBookingWithCheckout } from "@tbook/services";
import { requireApiKeyGroup } from "@/lib/v1/auth";
import { enforceV1RateLimit } from "@/lib/v1/rate-limit";
import { runV1, V1HttpError } from "@/lib/v1/response";

/**
 * v1 — byte-compatible with the legacy plugin's public POST /bookings.
 * A body with an `entries` array books several events in one Stripe
 * checkout (multi-event); otherwise it's a single-event booking.
 * Preview mode (X-TBook-Preview): every check runs, nothing is saved or
 * sent — `{ preview: true, status, registrationNumber: "PREVIEW-…", bookingId: null }`.
 * Test mode (X-TBook-Preview + `X-TBook-Test: 1`, single event, free
 * registrations): a real booking, also on a draft event, saved as a test
 * booking and emailed with "[TESZT] " subjects — the normal response plus
 * `test: true`. Test bookings take no capacity or bus seats and never
 * block a live guest's ID.
 */
export async function POST(request: Request) {
  return runV1(request, async () => {
    const { groupId, preview, test } = await requireApiKeyGroup(request);
    enforceV1RateLimit(request, "t-book:bookings", 20);
    const body = await request.json();
    if (Array.isArray(body?.entries)) {
      if (preview) throw new V1HttpError(400, "Előnézeti módban több esemény egyszerre nem foglalható.");
      return createMultiBookingWithCheckout(body, { groupId });
    }
    if (test) return createTestBookingWithCheckout(body, { groupId });
    if (preview) return previewBookingWithCheckout(body, { groupId });
    return createBookingWithCheckout(body, { groupId });
  });
}
