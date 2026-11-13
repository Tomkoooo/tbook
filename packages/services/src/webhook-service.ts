import crypto from "node:crypto";
import { OrganizationModel, eventGroupRepository, organizationRepository, type IBooking, type IVoucher } from "@tbook/db";
import type { OrgWebhook, WebhookEventType } from "@tbook/schemas";
import { decryptOrgSecret, encryptOrgSecret } from "./org-secrets";
import { AFTER_BOOKING_PAID_HOOKS } from "./checkout-service";

/**
 * Outbound webhooks: the generic extension point for this platform.
 *
 * The point is that wiring tBook to a new system (Zapier/Make/n8n, a CRM,
 * a Slack relay, a spreadsheet, a custom service) stops needing a code
 * change and a deploy. The per-org endpoints are configured in the admin
 * console; this module signs and delivers the payloads.
 *
 * Deliveries are best-effort and never allowed to fail the business
 * operation that produced them: a booking must not fail to be paid because
 * someone's Zapier hook is down. Every delivery error is swallowed after
 * being recorded on the endpoint itself (`lastStatus`/`lastError`), so an
 * admin can see a broken integration in the UI without needing log access.
 */

const DELIVERY_TIMEOUT_MS = 5_000;
const SIGNATURE_HEADER = "X-TBook-Signature";
const EVENT_HEADER = "X-TBook-Event";
const DELIVERY_HEADER = "X-TBook-Delivery";

export interface WebhookPayload {
  event: WebhookEventType;
  /** ISO timestamp — part of the signed body, so a replay is detectable. */
  sentAt: string;
  organizationId: string;
  data: Record<string, unknown>;
}

/**
 * `sha256=<hex>` over the exact request body. Hex-encoded HMAC compared
 * with timingSafeEqual on the receiving side — the same scheme Stripe and
 * GitHub use, so an existing verification snippet works unchanged.
 */
export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

/**
 * Constant-time signature check. Exported so a receiver inside this
 * codebase (and the test suite) can verify without reimplementing it.
 */
export function verifyWebhookSignature(body: string, secret: string, signature: string): boolean {
  const expected = Buffer.from(signWebhookBody(body, secret), "utf8");
  const actual = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on a length mismatch, which is itself a leak of
  // nothing useful but does need handling before the comparison.
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("base64url")}`;
}

/** Opaque, stable id for a configured endpoint. */
export function generateWebhookId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export interface DeliveryOutcome {
  webhookId: string;
  ok: boolean;
  status: number | null;
  error: string | null;
}

/**
 * POSTs one payload to one endpoint. Resolves (never rejects) with the
 * outcome, and bounds itself with an AbortController — an endpoint that
 * accepts the connection and then hangs would otherwise pin the
 * after-payment hook open indefinitely.
 */
export async function deliverWebhook(
  webhook: OrgWebhook,
  payload: WebhookPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryOutcome> {
  const body = JSON.stringify(payload);
  const secret = webhook.secretEnc ? decryptOrgSecret(webhook.secretEnc) : "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetchImpl(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [EVENT_HEADER]: payload.event,
        [DELIVERY_HEADER]: crypto.randomUUID(),
        ...(secret ? { [SIGNATURE_HEADER]: signWebhookBody(body, secret) } : {}),
      },
      body,
      signal: controller.signal,
      redirect: "error",
    });

    return {
      webhookId: webhook.id,
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "delivery failed";
    return {
      webhookId: webhook.id,
      ok: false,
      status: null,
      // An abort is the timeout firing; naming it beats surfacing "This operation was aborted".
      error: controller.signal.aborted ? `timed out after ${DELIVERY_TIMEOUT_MS}ms` : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Records the delivery result on the endpoint so the console can show it. */
async function recordOutcome(organizationId: string, outcome: DeliveryOutcome): Promise<void> {
  await OrganizationModel.updateOne(
    { _id: organizationId, "settings.webhooks.id": outcome.webhookId },
    {
      $set: {
        "settings.webhooks.$.lastStatus": outcome.status,
        "settings.webhooks.$.lastError": outcome.error,
        "settings.webhooks.$.lastDeliveredAt": new Date(),
      },
    },
  );
}

/**
 * Fans an event out to every enabled endpoint subscribed to it.
 *
 * Never throws: it is called from inside business operations (the paid
 * hook, admin cancellation, a door scan) that must not fail because an
 * integration endpoint is misconfigured or offline.
 */
export async function dispatchWebhookEvent(
  organizationId: string | null,
  event: WebhookEventType,
  data: Record<string, unknown>,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<DeliveryOutcome[]> {
  if (!organizationId) return [];

  try {
    const webhooks = await listWebhooks(organizationId);
    const targets = webhooks.filter((hook) => hook.enabled && hook.events.includes(event));
    if (targets.length === 0) return [];

    const payload: WebhookPayload = { event, sentAt: new Date().toISOString(), organizationId, data };

    const outcomes = await Promise.all(targets.map((hook) => deliverWebhook(hook, payload, opts.fetchImpl)));
    await Promise.all(outcomes.map((outcome) => recordOutcome(organizationId, outcome).catch(() => undefined)));

    for (const outcome of outcomes) {
      if (!outcome.ok) console.error("[tbook webhook]", event, outcome.webhookId, outcome.error);
    }
    return outcomes;
  } catch (error) {
    console.error("[tbook webhook] dispatch failed", event, error);
    return [];
  }
}

/* ---- Payload builders ------------------------------------------------ */

/**
 * The booking shape sent to integrations. A curated projection, not the
 * raw document: a webhook payload is a published contract, so adding a
 * field to the model must not silently start leaking it to third parties
 * (Stripe ids and the attendee field-schema snapshot are deliberately out).
 */
export function bookingWebhookData(booking: IBooking): Record<string, unknown> {
  return {
    id: String(booking._id),
    status: booking.status,
    eventId: booking.eventId ? String(booking.eventId) : null,
    eventName: booking.eventName ?? "",
    groupName: booking.groupName ?? "",
    hotelName: booking.hotelName ?? "",
    customer: {
      name: booking.customer?.name ?? "",
      email: booking.customer?.email ?? "",
      phone: booking.customer?.phone ?? "",
    },
    guests: booking.guests ?? 0,
    nights: booking.nights ?? 0,
    totalHuf: booking.totalHuf ?? 0,
    currency: booking.currency ?? "HUF",
    paidAt: booking.paidAt ? new Date(booking.paidAt).toISOString() : null,
    invoiceStatus: booking.invoiceStatus ?? "none",
    createdAt: booking.createdAt ? new Date(booking.createdAt).toISOString() : null,
  };
}

export function voucherWebhookData(voucher: IVoucher): Record<string, unknown> {
  return {
    id: String(voucher._id),
    bookingId: voucher.bookingId ? String(voucher.bookingId) : null,
    eventId: voucher.eventId ? String(voucher.eventId) : null,
    attendeeIndex: voucher.attendeeIndex ?? 0,
    displayName: voucher.displayName ?? "",
    status: voucher.status,
    checkedInAt: voucher.checkedInAt ? new Date(voucher.checkedInAt).toISOString() : null,
    // The token is the credential that admits someone — never published.
  };
}

/* ---- Endpoint management -------------------------------------------- */

export interface UpsertWebhookInput {
  organizationId: string;
  id?: string;
  url: string;
  description?: string;
  events: WebhookEventType[];
  enabled?: boolean;
}

/**
 * Creates or updates an endpoint. A newly created one gets a generated
 * signing secret, returned in plaintext exactly once — it is stored
 * encrypted and never readable again, same as every other org secret.
 */
export async function upsertWebhook(input: UpsertWebhookInput): Promise<{ webhook: OrgWebhook; secret?: string }> {
  const org = await organizationRepository.findById(input.organizationId);
  if (!org) throw new Error("Organization not found");

  // Via listWebhooks (lean) rather than off the hydrated document, so the
  // spread below copies real fields — see listWebhooks' note.
  const existing = input.id ? (await listWebhooks(input.organizationId)).find((hook) => hook.id === input.id) : undefined;

  if (existing) {
    const updated: OrgWebhook = {
      ...existing,
      url: input.url,
      description: input.description ?? existing.description,
      events: input.events,
      enabled: input.enabled ?? existing.enabled,
    };
    await OrganizationModel.updateOne(
      { _id: input.organizationId, "settings.webhooks.id": existing.id },
      {
        $set: {
          "settings.webhooks.$.url": updated.url,
          "settings.webhooks.$.description": updated.description,
          "settings.webhooks.$.events": updated.events,
          "settings.webhooks.$.enabled": updated.enabled,
        },
      },
    );
    return { webhook: updated };
  }

  const secret = generateWebhookSecret();
  const webhook: OrgWebhook = {
    id: generateWebhookId(),
    url: input.url,
    description: input.description ?? "",
    events: input.events,
    enabled: input.enabled ?? true,
    secretEnc: encryptOrgSecret(secret),
    createdAt: new Date(),
    lastStatus: null,
    lastError: null,
    lastDeliveredAt: null,
  };

  await OrganizationModel.updateOne({ _id: input.organizationId }, { $push: { "settings.webhooks": webhook } });
  return { webhook, secret };
}

export async function deleteWebhook(organizationId: string, webhookId: string): Promise<void> {
  await OrganizationModel.updateOne({ _id: organizationId }, { $pull: { "settings.webhooks": { id: webhookId } } });
}

/**
 * Reads the configured endpoints as plain objects.
 *
 * `.lean()` is load-bearing, not an optimization: spreading or copying a
 * hydrated Mongoose subdocument yields its internals (`$__`,
 * `__parentArray`, …) rather than its fields, so a `{ ...hook }` over a
 * hydrated array silently produces objects whose `url`/`events` are
 * undefined. (Same trap as the one in cancelBooking's customer note.)
 */
export async function listWebhooks(organizationId: string): Promise<OrgWebhook[]> {
  const org = await OrganizationModel.findById(organizationId)
    .select("settings.webhooks")
    .lean<{ settings?: { webhooks?: OrgWebhook[] } } | null>()
    .exec();
  return org?.settings?.webhooks ?? [];
}

/**
 * Sends a `booking.paid`-shaped sample to one endpoint so an admin can
 * verify their receiver before a real booking depends on it. Returns the
 * outcome rather than throwing, and records it like any other delivery.
 */
export async function sendTestWebhook(
  organizationId: string,
  webhookId: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<DeliveryOutcome> {
  const webhooks = await listWebhooks(organizationId);
  const webhook = webhooks.find((hook) => hook.id === webhookId);
  if (!webhook) throw new Error("Webhook not found");

  const payload: WebhookPayload = {
    event: "booking.paid",
    sentAt: new Date().toISOString(),
    organizationId,
    data: {
      test: true,
      id: "000000000000000000000000",
      status: "paid",
      eventName: "Test event",
      customer: { name: "Test Customer", email: "test@example.com", phone: "+36000000000" },
      guests: 1,
      totalHuf: 1000,
      currency: "HUF",
    },
  };

  const outcome = await deliverWebhook(webhook, payload, opts.fetchImpl);
  await recordOutcome(organizationId, outcome).catch(() => undefined);
  return outcome;
}

/* ---- Hook registration ---------------------------------------------- */

/**
 * Resolves the org that should receive a booking's webhooks. Falls back to
 * the booking's group because real legacy bookings carry no
 * `organizationId` (see scripts/migration-fixtures) — without the fallback
 * an org's oldest bookings would silently never fire a webhook.
 */
export async function resolveWebhookOrganizationId(booking: IBooking): Promise<string | null> {
  if (booking.organizationId) return String(booking.organizationId);
  if (!booking.groupId) return null;
  const group = await eventGroupRepository.findById(String(booking.groupId));
  return group?.organizationId ? String(group.organizationId) : null;
}

/** Registered into checkout-service's AFTER_BOOKING_PAID_HOOKS, alongside invoicing/tDarts/voucher delivery. */
export async function webhookAfterBookingPaidHook(booking: IBooking): Promise<void> {
  if (booking.isTest) return; // test bookings never leave tBook
  const organizationId = await resolveWebhookOrganizationId(booking);
  await dispatchWebhookEvent(organizationId, "booking.paid", bookingWebhookData(booking));
}

AFTER_BOOKING_PAID_HOOKS.push(webhookAfterBookingPaidHook);
