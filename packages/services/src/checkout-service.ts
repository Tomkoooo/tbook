import { Types } from "mongoose";
import Stripe from "stripe";
import { ActionError } from "@tbook/actions";
import { bookingRepository, eventRepository, organizationRepository, voucherRepository, type IBooking } from "@tbook/db";
import { assertValidBookingStatusTransition, createPendingBooking, expireBooking, type BookingPolicyOverrides, type CreateBookingInput } from "./booking-service";
import { createPendingMultiBookings, releaseMultiBookings, type CreateMultiBookingInput } from "./multi-booking-service";
import { extensions } from "./extensions";
import { resolveModules } from "./module-registry";
import { decryptOrgSecret } from "./org-secrets";
import { issueVoucherRowsForBooking } from "./voucher-service";

/**
 * Ported from the legacy plugin's services/checkout-service.ts: single-event
 * checkout (createBookingWithCheckout) and multi-event checkout
 * (createMultiBookingWithCheckout: several bookings, one Stripe session).
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
 * Stripe returns the buyer to `<returnBase>/foglalas/siker`, the success page
 * every storefront plugin serves (tBook's own storefront redirects it to
 * /book/success).
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
  /**
   * Where to send the guest next: Stripe's checkout, or — for a booking
   * confirmed without payment (free registration) — straight to the
   * storefront's success page, so an unchanged storefront still works.
   */
  checkoutUrl: string | null;
  stripeSessionId: string;
  expiresAt: string;
  /** Added fields (v1 additions, never renamed): set when no payment step was needed. */
  status?: "confirmed";
  registrationNumber?: string | null;
}

export interface MultiCheckoutResult extends CheckoutResult {
  bookingIds: string[];
  checkoutBundleId: string;
}

/** The path, under the storefront's base URL, Stripe sends the buyer back to. */
export const CHECKOUT_SUCCESS_PATH = "/foglalas/siker";

function lineItemDescription(booking: IBooking): string {
  return [`${booking.guests} guests`, booking.hotelName ? `${booking.hotelName}, ${booking.nights} nights` : "entry only"].join(" · ");
}

/**
 * Opens one Stripe Checkout Session for one or more pending bookings (a line
 * item each) and moves them all to checkout_started. The first booking is
 * the primary: its id is in the return URL and the session's
 * client_reference_id.
 */
async function openStripeCheckout(
  bookings: IBooking[],
  extra: { returnBaseUrl?: string | null; checkoutBundleId?: string },
): Promise<{ sessionId: string; url: string | null; expiresAt: Date }> {
  const primary = bookings[0]!;
  const organizationId = primary.organizationId ? String(primary.organizationId) : null;
  await assertOrgStripeReady(organizationId);

  const expiresAt = new Date(Date.now() + clampReservationTtlMs());
  const stripe = await getOrgStripeClient(organizationId);
  const storefrontBase = (primary.checkoutReturnBaseUrl?.trim() || extra.returnBaseUrl?.trim() || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const primaryId = String(primary._id);
  const returnTo = encodeURIComponent(storefrontBase);

  const metadata: Record<string, string> = { tBookBookingId: primaryId, tBookOrganizationId: organizationId ?? "" };
  if (extra.checkoutBundleId) {
    metadata.tBookBookingIds = bookings.map((b) => String(b._id)).join(",");
    metadata.tBookCheckoutBundleId = extra.checkoutBundleId;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${storefrontBase}${CHECKOUT_SUCCESS_PATH}?bookingId=${primaryId}&session_id={CHECKOUT_SESSION_ID}&return_to=${returnTo}`,
    cancel_url: `${storefrontBase}${CHECKOUT_SUCCESS_PATH}?bookingId=${primaryId}&cancelled=1&return_to=${returnTo}`,
    client_reference_id: primaryId,
    metadata,
    payment_intent_data: { metadata },
    line_items: bookings.map((booking) => ({
      quantity: 1,
      price_data: {
        currency: stripeCurrencyCode(booking.currency),
        unit_amount: toStripeUnitAmount(booking.totalHuf, booking.currency),
        product_data: { name: booking.eventName, description: lineItemDescription(booking) },
      },
    })),
    payment_method_types: ["card"],
    expires_at: stripeCheckoutExpiresAtUnix(expiresAt),
    customer_email: primary.customer.email,
  });

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  for (const booking of bookings) {
    assertValidBookingStatusTransition(booking.status, "checkout_started");
    await bookingRepository.updateById(String(booking._id), {
      status: "checkout_started",
      stripeSessionId: session.id,
      stripePaymentIntentId: paymentIntentId ?? null,
      expiresAt,
    });
  }

  return { sessionId: session.id, url: session.url, expiresAt };
}

/**
 * Full public booking flow: validate + price server-side (createPendingBooking,
 * already atomic against capacity), then open a Stripe Checkout Session.
 * Secrets never leave the server.
 */
export async function createBookingWithCheckout(
  input: CreateBookingWithCheckoutInput,
  opts?: { groupId?: string; returnBaseUrl?: string } & BookingPolicyOverrides,
): Promise<CheckoutResult> {
  const { returnBaseUrl: _returnBaseUrl, ...policy } = opts ?? {};
  const booking = await createPendingBooking(input, policy);

  if (await bookingBypassesCheckout(booking)) {
    const confirmed = await confirmBookingWithoutPayment(String(booking._id));
    const storefrontBase = (booking.checkoutReturnBaseUrl?.trim() || opts?.returnBaseUrl?.trim() || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    return {
      bookingId: String(booking._id),
      totalHuf: 0,
      checkoutUrl: `${storefrontBase}${CHECKOUT_SUCCESS_PATH}?bookingId=${String(booking._id)}&return_to=${encodeURIComponent(storefrontBase)}`,
      stripeSessionId: "",
      expiresAt: new Date().toISOString(),
      status: "confirmed",
      registrationNumber: confirmed.registrationNumber ?? null,
    };
  }

  let session: Awaited<ReturnType<typeof openStripeCheckout>>;
  try {
    session = await openStripeCheckout([booking], { returnBaseUrl: input.returnBaseUrl || opts?.returnBaseUrl });
  } catch (error) {
    // No session means nobody can pay for it: give the seats back now.
    await expireBooking(String(booking._id));
    throw error;
  }

  return {
    bookingId: String(booking._id),
    totalHuf: booking.totalHuf,
    checkoutUrl: session.url,
    stripeSessionId: session.sessionId,
    expiresAt: session.expiresAt.toISOString(),
  };
}

/**
 * Multi-event booking: one pending booking per event (sharing a
 * checkoutBundleId) and one Stripe session with a line item per booking.
 * If the session can't be opened, the bookings are expired so their
 * capacity is released.
 */
export async function createMultiBookingWithCheckout(input: CreateMultiBookingInput, opts?: { groupId?: string; returnBaseUrl?: string }): Promise<MultiCheckoutResult> {
  const { bookings: allBookings, checkoutBundleId } = await createPendingMultiBookings(input, { groupId: opts?.groupId });

  // Free registrations in the bundle are confirmed at once; only the rest
  // (if any) go to payment.
  const free: IBooking[] = [];
  const bookings: IBooking[] = [];
  for (const booking of allBookings) (await bookingBypassesCheckout(booking) ? free : bookings).push(booking);
  for (const booking of free) await confirmBookingWithoutPayment(String(booking._id));

  if (bookings.length === 0) {
    const primary = allBookings[0]!;
    const storefrontBase = (primary.checkoutReturnBaseUrl?.trim() || input.returnBaseUrl?.trim() || opts?.returnBaseUrl?.trim() || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    return {
      bookingId: String(primary._id),
      bookingIds: allBookings.map((b) => String(b._id)),
      checkoutBundleId,
      totalHuf: 0,
      checkoutUrl: `${storefrontBase}${CHECKOUT_SUCCESS_PATH}?bookingId=${String(primary._id)}&return_to=${encodeURIComponent(storefrontBase)}`,
      stripeSessionId: "",
      expiresAt: new Date().toISOString(),
      status: "confirmed",
      registrationNumber: (await bookingRepository.findById(String(primary._id)))?.registrationNumber ?? null,
    };
  }

  let session: Awaited<ReturnType<typeof openStripeCheckout>>;
  try {
    session = await openStripeCheckout(bookings, { returnBaseUrl: input.returnBaseUrl || opts?.returnBaseUrl, checkoutBundleId });
  } catch (error) {
    await releaseMultiBookings(bookings);
    throw error;
  }

  return {
    bookingId: String(bookings[0]!._id),
    bookingIds: allBookings.map((b) => String(b._id)),
    checkoutBundleId,
    totalHuf: bookings.reduce((sum, b) => sum + b.totalHuf, 0),
    checkoutUrl: session.url,
    stripeSessionId: session.sessionId,
    expiresAt: session.expiresAt.toISOString(),
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

/**
 * True when a module says this booking needs no payment step (e.g. the
 * free-registration module for a zero-total booking). Only zero-total
 * bookings are ever eligible, whatever a module answers.
 */
export async function bookingBypassesCheckout(booking: IBooking): Promise<boolean> {
  if (booking.totalHuf > 0) return false;
  const bypasses = extensions.checkoutBypasses();
  if (bypasses.length === 0) return false;
  const eventDoc = await eventRepository.findById(String(booking.eventId));
  if (!eventDoc) return false;
  const organizationId = booking.organizationId ? String(booking.organizationId) : null;
  const groupId = booking.groupId ? String(booking.groupId) : null;
  const modules = await resolveModules({ organizationId, groupId, event: eventDoc });
  for (const bypass of bypasses) {
    if (await bypass(booking, { event: eventDoc, organizationId, groupId, modules })) return true;
  }
  return false;
}

/**
 * Confirms a zero-total booking with no payment step: it becomes
 * `confirmed` (recorded as a comp), and every after-payment step runs —
 * vouchers, the confirmation email, module hooks.
 */
export async function confirmBookingWithoutPayment(bookingId: string): Promise<IBooking> {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) throw ActionError.notFound("Booking not found.");
  if (booking.totalHuf > 0) throw ActionError.validation("Only a free booking can be confirmed without payment.");
  if (booking.status === "confirmed") return booking;
  if (booking.status !== "pending") throw ActionError.validation(`A ${booking.status} booking can't be confirmed.`);
  const updated = await bookingRepository.updateById(bookingId, {
    status: "confirmed",
    paymentMethod: "comp",
    paidAt: new Date(),
    expiresAt: null,
    invoiceStatus: "none",
  });
  await afterBookingPaid(updated!);
  return updated!;
}

/**
 * Runs every after-payment side effect: voucher rows, PDF + email,
 * Számlázz.hu invoice, tDarts enrolment, outbound webhooks.
 *
 * Exported because a Stripe webhook is no longer the only way a booking
 * gets paid — an org manager recording a bank transfer has to produce the
 * same artefacts, or the guest gets no ticket and the organizer no invoice
 * (see registration-admin-service's markBookingPaidOffline).
 */
export async function afterBookingPaid(booking: IBooking): Promise<void> {
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
  // Module hooks run last, once vouchers (and their QR tokens) exist.
  const fresh = (await bookingRepository.findById(String(booking._id))) ?? booking;
  for (const hook of extensions.bookingConfirmedHooks()) {
    try {
      await hook(fresh);
    } catch (error) {
      console.error("[tbook] booking confirmed hook failed", String(booking._id), error);
    }
  }
}

type SessionRef = Pick<Stripe.Checkout.Session, "id" | "metadata" | "client_reference_id">;

/**
 * Every booking a Stripe session pays for: the primary from the metadata,
 * the rest of a multi-event bundle from `tBookBookingIds`, plus anything
 * stored with this session id. Callers still match on the session id when
 * writing, so a forged id in the list can't touch another booking.
 */
async function bookingIdsForSession(session: SessionRef): Promise<{ primaryId: string | null; ids: string[] }> {
  const primaryId = session.metadata?.tBookBookingId || session.client_reference_id || null;
  const fromMetadata = (session.metadata?.tBookBookingIds ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => Types.ObjectId.isValid(id));
  const stored = session.id ? (await bookingRepository.findAllByStripeSessionId(session.id)).map((b) => String(b._id)) : [];
  const ids = [...new Set([primaryId, ...fromMetadata, ...stored].filter((id): id is string => Boolean(id) && Types.ObjectId.isValid(id!)))];
  return { primaryId, ids };
}

/**
 * Idempotent webhook finalization: mark paid, issue vouchers, run
 * afterBookingPaid hooks — for every booking in the session (several for a
 * multi-event bundle). Safe to call more than once for the same Stripe
 * session (webhook retries, or the guest-polling fallback in
 * getCheckoutStatus racing the webhook) — bookingRepository.markPaidIfPending's
 * CAS filter makes every call after the first a no-op. Returns the primary
 * booking id when this call finalized anything, else null.
 */
export async function finalizeBookingFromStripeSession(session: Pick<Stripe.Checkout.Session, "id" | "payment_status" | "metadata" | "client_reference_id">): Promise<string | null> {
  if (session.payment_status !== "paid") return null;

  const { primaryId, ids } = await bookingIdsForSession(session);
  if (!primaryId) return null;

  let finalizedAny = false;
  for (const bookingId of ids) {
    const booking = await bookingRepository.markPaidIfPending(bookingId, session.id, new Date());
    if (!booking) continue; // already finalized (or session id mismatch) — safe no-op
    finalizedAny = true;
    await afterBookingPaid(booking);
  }
  return finalizedAny ? primaryId : null;
}

/** Releases the reservations when Stripe reports the checkout session expired. */
export async function expireBookingFromStripeSession(session: SessionRef): Promise<void> {
  const { ids } = await bookingIdsForSession(session);
  for (const bookingId of ids) {
    const booking = await bookingRepository.findById(bookingId);
    // Only bookings that were actually opened with this session.
    if (booking && booking.stripeSessionId && booking.stripeSessionId !== session.id) continue;
    await expireBooking(bookingId);
  }
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

  // A multi-event bundle is paid as one: report its total, not the primary's share.
  const bundle = resolved.checkoutBundleId ? await bookingRepository.findByCheckoutBundleId(resolved.checkoutBundleId) : [];
  const parts = bundle.length > 1 ? bundle : [resolved];

  return {
    status: resolved.status,
    totalHuf: parts.reduce((sum, b) => sum + b.totalHuf, 0),
    guests: parts.reduce((sum, b) => sum + b.guests, 0),
    eventName: parts.map((b) => b.eventName).join(", "),
    vouchersReady,
    returnBaseUrl: resolved.checkoutReturnBaseUrl ?? null,
  };
}

/**
 * Guest-checkout access gate for the invoice/voucher PDF download routes —
 * bookingId + stripeSessionId is the bearer-token pair (no login). Ported
 * from the legacy plugin's lib/booking-checkout-access.ts. `403` (not the
 * `400` ActionError.validation uses elsewhere) matches the legacy status
 * code for a session mismatch specifically.
 */
export async function loadBookingForGuestCheckout(bookingId: string, stripeSessionId: string | null | undefined): Promise<IBooking> {
  if (!bookingId?.trim()) {
    throw new ActionError(400, "validation_error", "Invalid booking.");
  }
  if (!stripeSessionId?.trim()) {
    throw new ActionError(400, "validation_error", "Missing Stripe session.");
  }
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw ActionError.notFound("Booking not found.");
  }
  if (booking.stripeSessionId && booking.stripeSessionId !== stripeSessionId) {
    throw new ActionError(403, "forbidden", "Session mismatch.");
  }
  return booking;
}

/**
 * Stripe webhook entry point. The route hands over the raw body and the
 * signature header; nothing in the payload is trusted until the signature
 * has been verified.
 *
 * Each organization can have its own Stripe account and so its own webhook
 * signing secret. The secret to verify with depends on which org the event
 * belongs to, and that is only known from inside the payload — so the
 * unverified body is read *only* to pick candidate secrets, and the
 * signature is then checked against those. A forged payload naming some
 * other org still fails, because it cannot be signed with that org's secret.
 */
export async function handleStripeWebhook(rawBody: string, signature: string): Promise<{ handled: boolean; type: string }> {
  let organizationId: string | null = null;
  try {
    const hint = JSON.parse(rawBody) as { data?: { object?: { metadata?: Record<string, string> } } };
    organizationId = hint.data?.object?.metadata?.tBookOrganizationId || null;
  } catch {
    throw ActionError.validation("Invalid webhook body.");
  }

  const candidates: string[] = [];
  if (organizationId) {
    const org = await organizationRepository.findById(organizationId);
    const orgSecret = decryptOrgSecret(org?.settings?.stripe?.webhookSecretEnc);
    if (orgSecret) candidates.push(orgSecret);
  }
  const platformSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (platformSecret) candidates.push(platformSecret);
  if (candidates.length === 0) throw ActionError.validation("No Stripe webhook secret is configured.");

  // constructEvent only does HMAC work; the key on the client is irrelevant to it.
  const verifier = new Stripe("sk_unused", { apiVersion: STRIPE_API_VERSION });
  let event: Stripe.Event | null = null;
  for (const secret of candidates) {
    try {
      event = verifier.webhooks.constructEvent(rawBody, signature, secret);
      break;
    } catch {
      // try the next candidate
    }
  }
  if (!event) throw ActionError.validation("Invalid webhook signature.");

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await finalizeBookingFromStripeSession(event.data.object as Stripe.Checkout.Session);
      return { handled: true, type: event.type };
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      await expireBookingFromStripeSession(event.data.object as Stripe.Checkout.Session);
      return { handled: true, type: event.type };
    default:
      return { handled: false, type: event.type };
  }
}
