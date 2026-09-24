import { NextResponse } from "next/server";

/**
 * tBook owns its Stripe webhook outright (fixes the legacy cross-plugin
 * coupling where payment finalization was triggered from the generic shop
 * plugin's webhook via a string checkoutKind tag). Phase 2/3 fills in
 * signature verification (stripe.webhooks.constructEvent) and delegates to
 * @tbook/services' checkout service (finalizeBookingFromStripeSession /
 * expireBooking).
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: { code: "missing_signature" } }, { status: 400 });
  }
  // TODO(phase-3): verify signature, dispatch to checkout service.
  return NextResponse.json({ received: true });
}
