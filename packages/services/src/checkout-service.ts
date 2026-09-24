import Stripe from "stripe";
import { ActionError } from "@tbook/actions";
import { bookingRepository, organizationRepository, voucherRepository, type IBooking } from "@tbook/db";
import { assertValidBookingStatusTransition, createPendingBooking, expireBooking, type CreateBookingInput } from "./booking-service";
import { decryptOrgSecret } from "./org-secrets";
import { issueVoucherRowsForBooking } from "./voucher-service";

/**
 * Ported from the legacy plugin's services/checkout-service.ts. Only the
 * single-event path (createBookingWithCheckout) is ported this pass —
 * createMultiBookingWithCheckout depends on createPendingMultiBookings,
 * which isn't built yet (out of scope, see booking-service.ts's header).
 *
 * Deliberate architectural fix per the approved plan: the legacy webhook
 * lives in an unrelated `shop` plugin and dispatches to tbook via a string
 * `checkoutKind` metadata tag on the Stripe session/payment-intent. This
 * rewrite has no shop plugin, so tbook owns Stripe outright —
 * `finalizeBookingFromStripeSession`/`expireBookingFromStripeSession` in
 * this file ARE the webhook's implementation; a later phase just wires
 * `apps/web/src/app/api/webhooks/stripe/route.ts` to call them directly
 * after verifying the signature. No metadata-tag dispatch needed.
 *
 * downloadInvoiceForGuestCheckout / downloadVouchersForGuestCheckout (guest
 * PDF download) and the multi-booking path are deferred along with
 * invoice-service/voucher PDF rendering.
 */

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-08-26.dahlia";

/** Currencies Stripe treats as having no minor unit (amounts are NOT ×100). */
const ZERO_DECIMAL_CURRENCIES = new Set(["huf", "jpy", "krw", "vnd"]);

export function stripeCurrencyCode(currency: string | null | undefined): string {
  return (currency || "HUF").trim().toLowerCase();
}

/** Convert a major-unit amount to Stripe's integer `unit_amount`. */
export function toStripeUnitAmount(amount: number, currency: string | null | undefined): number {
  const code = stripeCurrencyCode(currency);
  const major = Math.max(0, Number(amount) || 0);
  return ZERO_DECIMAL_CURRENCIES.has(code) ? Math.max(1, Math.round(major)) : Math.max(1, Math.round(major * 100));
}

/** Reservation hold duration, clamped between env-configurable bounds (default 30–60 min). */
function clampReservationTtlMs(): number {
  const min = Number(process.env.RESERVATION_TTL_MIN_MS) || 30 * 60 * 1000;
  const max = Math.max(min, Number(process.env.RESERVATION_TTL_MAX_MS) || 60 * 60 * 1000);
  return Math.min(Math.max(min, min), max);
}

/** Seconds subtracted from the DB reservation end so the Stripe session expires first (safety margin). */
function stripeSessionBufferSec(): number {
  const n = Number(process.env.RESERVATION_STRIPE_SESSION_BUFFER_SEC);
  return Number.isFinite(n) && n >= 0 && n < 3600 ? Math.floor(n) : 60;
}

function stripeCheckoutExpiresAtUnix(expiresAt: Date): number {
  return Math.floor(expiresAt.getTime() / 1000) - stripeSessionBufferSec();
}

/**
 * Resolves the org's own Stripe secret key if configured, else falls back
 * to the platform key (STRIPE_SECRET_KEY env) — same fallback chain as the
 * legacy plugin's getOrgStripeClient, minus the removed FeatureFlagService
 * dependency (this rewrite has no platform-wide feature-flag system yet;
 * "platform Stripe enabled" is simply "STRIPE_SECRET_KEY is set").
 */
export async function resolveOrgStripeSecretKey(organizationId: string | null | undefined): Promise<string | null> {
  if (organizationId) {
    const org = await organizationRepository.findById(organizationId);
    const secret = decryptOrgSecret(org?.settings?.stripe?.secretKeyEnc);
    if (org?.settings?.stripe?.enabled && secret) return secret;
  }
  const platformKey = process.env.STRIPE_SECRET_KEY?.trim();
  return platformKey || null;
}

export async function assertOrgStripeReady(organizationId: string | null | undefined): Promise<void> {
  const key = await resolveOrgStripeSecretKey(organizationId);
  if (!key) {
    throw ActionError.validation(
      organizationId
        ? "This organization has no Stripe key configured. Set one in organization settings."
        : "Stripe payments are not configured.",
    );
  }
}

export async function getOrgStripeClient(organizationId: string | null | undefined): Promise<Stripe> {
  const key = await resolveOrgStripeSecretKey(organizationId);
  if (!key) throw ActionError.validation("No Stripe key available for this organization.");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

export interface CreateBookingWithCheckoutInput extends CreateBookingInput {
  returnBaseUrl?: string | null;
}

export interface CheckoutResult {
  bookingId: string;
  totalHuf: number;
  checkoutUrl: string | null;
  stripeSessionId: string;
  expiresAt: string;
}

/**
 * Full public booking flow: validate + price server-side (createPendingBooking,
 * already atomic against capacity), then open a Stripe Checkout Session.
 * Secrets never leave the server.
 */
export async function createBookingWithCheckout(input: CreateBookingWithCheckoutInput, opts?: { groupId?: string; returnBaseUrl?: string }): Promise<CheckoutResult> {
  const booking = await createPendingBooking(input, { groupId: opts?.groupId });

  const organizationId = booking.organizationId ? String(booking.organizationId) : null;
  await assertOrgStripeReady(organizationId);

  const now = new Date();
  const ttlMs = clampReservationTtlMs();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const stripe = await getOrgStripeClient(organizationId);
  const storefrontBase = booking.checkoutReturnBaseUrl?.trim() || input.returnBaseUrl?.trim() || opts?.returnBaseUrl?.trim() || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const bookingId = String(booking._id);
  const returnTo = encodeURIComponent(storefrontBase);

  const description = [`${booking.guests} guests`, booking.hotelName ? `${booking.hotelName}, ${booking.nights} nights` : "entry only"].join(" · ");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${storefrontBase}/book/success?bookingId=${bookingId}&session_id={CHECKOUT_SESSION_ID}&return_to=${returnTo}`,
    cancel_url: `${storefrontBase}/book/success?bookingId=${bookingId}&cancelled=1&return_to=${returnTo}`,
    client_reference_id: bookingId,
    metadata: { tBookBookingId: bookingId, tBookOrganizationId: organizationId ?? "" },
    payment_intent_data: { metadata: { tBookBookingId: bookingId, tBookOrganizationId: organizationId ?? "" } },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: stripeCurrencyCode(booking.currency),
          unit_amount: toStripeUnitAmount(booking.totalHuf, booking.currency),
          product_data: { name: booking.eventName, description },
        },
      },
    ],
    payment_method_types: ["card"],
    expires_at: stripeCheckoutExpiresAtUnix(expiresAt),
    customer_email: booking.customer.email,
  });

  assertValidBookingStatusTransition(booking.status, "checkout_started");
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  await bookingRepository.updateById(bookingId, {
    status: "checkout_started",
    stripeSessionId: session.id,
    stripePaymentIntentId: paymentIntentId ?? null,
    expiresAt,
  });

  return {
    bookingId,
    totalHuf: booking.totalHuf,
    checkoutUrl: session.url,
    stripeSessionId: session.id,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Extension point for the next pass: invoice-service and tdarts-sync-service
 * each register a hook here instead of this file importing them directly
 * (avoids a circular/premature dependency on services that don't exist
 * yet). Hooks run best-effort — a failure must never undo the payment or
 * block voucher issuance; each hook is responsible for catching its own
 * errors (matching the legacy plugin's fire-and-forget
 * `.catch(console.error)` pattern for invoice issuance / tDarts sync).
 */
export const AFTER_BOOKING_PAID_HOOKS: Array<(booking: IBooking) => Promise<void>> = [];

async function afterBookingPaid(booking: IBooking): Promise<void> {
  try {
    await issueVoucherRowsForBooking(String(booking._id));
  } catch (error) {
    console.error("[tbook] voucher issuance failed", String(booking._id), error);
  }
  for (const hook of AFTER_BOOKING_PAID_HOOKS) {
    try {
      await hook(booking);
    } catch (error) {
      console.error("[tbook] afterBookingPaid hook failed", String(booking._id), error);
    }
  }
}

/**
 * Idempotent webhook finalization: mark paid, issue vouchers, run
 * afterBookingPaid hooks. Safe to call more than once for the same Stripe
 * session (webhook retries, or the guest-polling fallback in
 * getCheckoutStatus racing the webhook) — bookingRepository.markPaidIfPending's
 * CAS filter makes every call after the first a no-op that returns null.
 */
export async function finalizeBookingFromStripeSession(session: Pick<Stripe.Checkout.Session, "id" | "payment_status" | "metadata" | "client_reference_id">): Promise<string | null> {
  if (session.payment_status !== "paid") return null;

  const bookingId = session.metadata?.tBookBookingId || session.client_reference_id;
  if (!bookingId) return null;

  const booking = await bookingRepository.markPaidIfPending(bookingId, session.id, new Date());
  if (!booking) return null; // already finalized (or session id mismatch) — safe no-op

  await afterBookingPaid(booking);
  return bookingId;
}

/** Releases the reservation when Stripe reports the checkout session expired. */
export async function expireBookingFromStripeSession(session: Pick<Stripe.Checkout.Session, "id" | "metadata" | "client_reference_id">): Promise<void> {
  const bookingId = session.metadata?.tBookBookingId || session.client_reference_id;
  if (!bookingId) return;
  await expireBooking(bookingId);
}

export interface CheckoutStatus {
  status: IBooking["status"];
  totalHuf: number;
  guests: number;
  eventName: string;
  vouchersReady: boolean;
  returnBaseUrl: string | null;
}

/**
 * Guest-facing status poll (no login — bookingId + stripeSessionId is the
 * bearer-token pair). Falls back to finalizing inline via the Stripe API
 * when the webhook hasn't landed yet by the time the success page loads.
 */
export async function getCheckoutStatus(bookingId: string, stripeSessionId?: string | null): Promise<CheckoutStatus> {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) throw ActionError.notFound("Booking not found.");

  if (stripeSessionId && booking.stripeSessionId && stripeSessionId !== booking.stripeSessionId) {
    throw ActionError.validation("Session mismatch.");
  }

  let resolved = booking;
  if (stripeSessionId && booking.status !== "paid" && booking.status !== "confirmed") {
    const stripe = await getOrgStripeClient(booking.organizationId ? String(booking.organizationId) : null);
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    if (session.payment_status === "paid") {
      await finalizeBookingFromStripeSession(session);
      resolved = (await bookingRepository.findById(bookingId)) ?? booking;
    }
  }

  const paid = resolved.status === "paid" || resolved.status === "confirmed";
  const vouchersReady = paid ? (await voucherRepository.findByBookingId(bookingId)).length > 0 : false;

  return {
    status: resolved.status,
    totalHuf: resolved.totalHuf,
    guests: resolved.guests,
    eventName: resolved.eventName,
    vouchersReady,
    returnBaseUrl: resolved.checkoutReturnBaseUrl ?? null,
  };
}
