/**
 * Placeholder post-checkout success page (legacy: /foglalas/siker,
 * TBookSuccessClient's polling UI). Phase 6 replaces this with the real
 * checkout-status polling client. Exists now only as a real redirect
 * target for /api/v1/checkout/return and the Stripe success_url.
 */
export default function BookingSuccessPage() {
  return (
    <main>
      <h1>Thank you for your booking</h1>
      <p>Checkout status — implemented in Phase 6.</p>
    </main>
  );
}
