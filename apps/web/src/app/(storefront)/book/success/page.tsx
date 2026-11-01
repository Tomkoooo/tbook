/**
 * Placeholder post-checkout success page (legacy: /foglalas/siker,
 * TBookSuccessClient's polling UI). Phase 6 replaces this with the real
 * checkout-status polling client. Exists now only as a real redirect
 * target for /api/v1/checkout/return and the Stripe success_url.
 */
export default function BookingSuccessPage() {
  return (
    <main className="mx-auto grid max-w-3xl gap-2 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Thank you for your booking</h1>
      <p className="text-muted-foreground">Checkout status — implemented in Phase 6.</p>
    </main>
  );
}
