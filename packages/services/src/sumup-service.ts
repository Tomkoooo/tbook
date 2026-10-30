import { randomBytes } from "node:crypto";
import { ActionError } from "@tbook/actions";
import { bookingRepository, organizationRepository } from "@tbook/db";
import type { OrgSumUpReader } from "@tbook/schemas";
import { cancelBooking } from "./booking-service";
import { decryptOrgSecret, encryptOrgSecret, maskSecret } from "./org-secrets";
import { buildPosSaleResult, posRegistration, type PosSaleInput, type PosSaleResult } from "./pos-service";
import { createAdminRegistration, markBookingPaidOffline } from "./registration-admin-service";
import {
  createReaderCheckout,
  findTransaction,
  pairReader,
  terminateReaderCheckout,
  type SumUpCredentials,
  type SumUpHttpOptions,
} from "./sumup-client";

/**
 * SumUp card terminals, configured per organization.
 *
 * The flow for a card sale on a paired Solo reader:
 *   1. a pending booking is created (capacity is held),
 *   2. the amount is pushed to the reader, which asks the customer to pay,
 *   3. the booking is settled when SumUp reports the result — by webhook,
 *      or by the seller's screen polling, whichever arrives first.
 *
 * The webhook is never trusted on its own: SumUp's `solo.transaction.updated`
 * carries no signature, so receiving one only prompts us to ask SumUp
 * (authenticated with the org's API key) what really happened. A forged
 * call can therefore at worst trigger a harmless status lookup.
 */

export interface SumUpSettingsView {
  enabled: boolean;
  merchantCode: string;
  apiKey: { configured: boolean; hint: string };
  affiliateAppId: string;
  affiliateKey: { configured: boolean; hint: string };
  readers: OrgSumUpReader[];
}

export async function getSumUpSettings(organizationId: string): Promise<SumUpSettingsView> {
  const org = await organizationRepository.findById(organizationId);
  const sumup = org?.settings?.sumup;
  return {
    enabled: sumup?.enabled ?? false,
    merchantCode: sumup?.merchantCode ?? "",
    apiKey: maskSecret(sumup?.apiKeyEnc),
    affiliateAppId: sumup?.affiliateAppId ?? "",
    affiliateKey: maskSecret(sumup?.affiliateKeyEnc),
    readers: (sumup?.readers ?? []).map((reader) => ({ id: reader.id, name: reader.name, model: reader.model })),
  };
}

/** Saves credentials. A blank secret keeps the stored one, so the form never has to echo secrets back. */
export async function saveSumUpSettings(
  organizationId: string,
  input: { enabled: boolean; merchantCode: string; apiKey?: string; affiliateAppId: string; affiliateKey?: string },
): Promise<void> {
  const org = await organizationRepository.findById(organizationId);
  if (!org) throw ActionError.notFound("Organization not found");
  const current = org.settings?.sumup;

  const apiKeyEnc = input.apiKey?.trim() ? encryptOrgSecret(input.apiKey) : (current?.apiKeyEnc ?? "");
  const affiliateKeyEnc = input.affiliateKey?.trim() ? encryptOrgSecret(input.affiliateKey) : (current?.affiliateKeyEnc ?? "");

  if (input.enabled && (!input.merchantCode.trim() || !apiKeyEnc || !input.affiliateAppId.trim() || !affiliateKeyEnc)) {
    throw ActionError.validation("To enable SumUp, fill in the merchant code, API key, affiliate app id and affiliate key.");
  }

  await organizationRepository.updateById(organizationId, {
    "settings.sumup": {
      enabled: input.enabled,
      merchantCode: input.merchantCode.trim(),
      apiKeyEnc,
      affiliateAppId: input.affiliateAppId.trim(),
      affiliateKeyEnc,
      readers: current?.readers ?? [],
    },
  } as never);
}

async function resolveCredentials(organizationId: string | null | undefined): Promise<SumUpCredentials> {
  const org = organizationId ? await organizationRepository.findById(String(organizationId)) : null;
  const sumup = org?.settings?.sumup;
  if (!sumup?.enabled) throw ActionError.validation("SumUp card terminals are not enabled for this organization.");
  const creds: SumUpCredentials = {
    merchantCode: sumup.merchantCode,
    apiKey: decryptOrgSecret(sumup.apiKeyEnc),
    affiliateAppId: sumup.affiliateAppId,
    affiliateKey: decryptOrgSecret(sumup.affiliateKeyEnc),
  };
  if (!creds.merchantCode || !creds.apiKey || !creds.affiliateAppId || !creds.affiliateKey) {
    throw ActionError.validation("SumUp credentials are incomplete or unreadable — re-save them in Integrations.");
  }
  return creds;
}

export async function pairSumUpReader(
  organizationId: string,
  input: { pairingCode: string; name: string },
  http: SumUpHttpOptions = {},
): Promise<OrgSumUpReader> {
  const creds = await resolveCredentials(organizationId);
  if (!input.pairingCode.trim() || !input.name.trim()) throw ActionError.validation("Enter the pairing code and a name for the reader.");

  const reader = await pairReader(creds, input, http);
  const org = await organizationRepository.findById(organizationId);
  const readers = [...(org?.settings?.sumup?.readers ?? []).filter((existing) => existing.id !== reader.id), { id: reader.id, name: reader.name, model: reader.model }];
  await organizationRepository.updateById(organizationId, { "settings.sumup.readers": readers } as never);
  return { id: reader.id, name: reader.name, model: reader.model };
}

/** Forgets a reader locally. (SumUp has its own delete; the merchant removes the reader there too.) */
export async function removeSumUpReader(organizationId: string, readerId: string): Promise<void> {
  const org = await organizationRepository.findById(organizationId);
  const readers = (org?.settings?.sumup?.readers ?? []).filter((reader) => reader.id !== readerId);
  await organizationRepository.updateById(organizationId, { "settings.sumup.readers": readers } as never);
}

/** Readers a seller can charge on right now; empty when SumUp is off. */
export async function listSellableReaders(organizationId: string): Promise<OrgSumUpReader[]> {
  const org = await organizationRepository.findById(organizationId);
  const sumup = org?.settings?.sumup;
  if (!sumup?.enabled) return [];
  return (sumup.readers ?? []).map((reader) => ({ id: reader.id, name: reader.name, model: reader.model }));
}

function webhookUrl(token: string): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  // SumUp only accepts an https return_url. Without one (local dev) the
  // seller's polling settles the sale instead.
  return base.startsWith("https://") ? `${base}/api/webhooks/sumup/${token}` : null;
}

export interface StartCardSaleResult {
  bookingId: string;
  clientTransactionId: string;
}

/**
 * Creates the pending sale and pushes the amount to the reader. If the
 * reader can't take it (busy, offline, bad key) the sale is cancelled again
 * straight away so it doesn't keep holding tickets.
 */
export async function startSumUpCardSale(
  organizationId: string,
  input: PosSaleInput & { readerId: string },
  actor: { userId: string | null },
  http: SumUpHttpOptions = {},
): Promise<StartCardSaleResult> {
  const creds = await resolveCredentials(organizationId);
  const org = await organizationRepository.findById(organizationId);
  const reader = (org?.settings?.sumup?.readers ?? []).find((candidate) => candidate.id === input.readerId);
  if (!reader) throw ActionError.validation("Choose one of this organization's paired readers.");

  const { booking } = await createAdminRegistration(organizationId, posRegistration(input), actor);
  const bookingId = String(booking._id);
  const token = randomBytes(24).toString("base64url");

  try {
    const { clientTransactionId } = await createReaderCheckout(
      creds,
      reader.id,
      {
        amount: booking.totalHuf,
        currency: booking.currency,
        returnUrl: webhookUrl(token),
        description: booking.eventName,
        foreignTransactionId: bookingId,
      },
      http,
    );
    await bookingRepository.updateById(bookingId, {
      cardCheckout: {
        provider: "sumup",
        readerId: reader.id,
        readerName: reader.name,
        clientTransactionId,
        webhookToken: token,
        status: "waiting",
        failureReason: null,
        transactionCode: null,
        startedAt: new Date(),
        settledAt: null,
      },
    } as never);
    return { bookingId, clientTransactionId };
  } catch (error) {
    await cancelBooking(bookingId, { reason: "Card payment could not be started" }).catch(() => undefined);
    throw error;
  }
}

export type CardSaleState =
  | { state: "waiting" }
  | { state: "paid"; sale: PosSaleResult }
  | { state: "failed"; reason: string }
  | { state: "cancelled" }
  /** Money moved but not the expected amount — the booking is left pending for a human. */
  | { state: "mismatch"; reason: string };

/**
 * Brings a card sale up to date with what SumUp says happened. Safe to call
 * from the webhook, from the seller's polling, or both at once: moving out
 * of "waiting" is a compare-and-set, so the after-payment pipeline runs once.
 */
export async function settleSumUpCheckout(bookingId: string, http: SumUpHttpOptions = {}): Promise<CardSaleState> {
  const booking = await bookingRepository.findById(bookingId);
  const checkout = booking?.cardCheckout;
  if (!booking || !checkout) throw ActionError.notFound("Card payment not found");

  if (checkout.status === "successful") {
    // Self-heal: a crash between "SumUp said yes" and "mark paid" must not
    // strand a taken payment on a pending booking. markBookingPaidOffline
    // is itself a compare-and-set, so this is a no-op when already paid.
    if (booking.status === "pending") {
      await markBookingPaidOffline(
        String(booking.organizationId),
        bookingId,
        { method: "card", reference: checkout.transactionCode ?? checkout.clientTransactionId, note: `SumUp reader ${checkout.readerName}` },
        { userId: booking.createdByUserId ? String(booking.createdByUserId) : null },
      ).catch(() => undefined);
    }
    return { state: "paid", sale: await buildPosSaleResult(bookingId) };
  }
  if (checkout.status === "cancelled") return { state: "cancelled" };
  if (checkout.status === "failed") return { state: "failed", reason: checkout.failureReason ?? "The payment was declined." };

  const creds = await resolveCredentials(booking.organizationId ? String(booking.organizationId) : null);
  const transaction = await findTransaction(creds, checkout.clientTransactionId, http);
  if (!transaction || transaction.status === "PENDING") return { state: "waiting" };

  if (transaction.status === "SUCCESSFUL") {
    // Never mark a sale paid for an amount we didn't ask for.
    const sameAmount = Math.abs(transaction.amount - booking.totalHuf) < 0.005;
    const sameCurrency = transaction.currency.toUpperCase() === booking.currency.toUpperCase();
    if (!sameAmount || !sameCurrency) {
      const reason = `SumUp charged ${transaction.amount} ${transaction.currency}, expected ${booking.totalHuf} ${booking.currency}.`;
      await bookingRepository.settleCardCheckout(bookingId, "failed", { failureReason: reason, transactionCode: transaction.transactionCode });
      return { state: "mismatch", reason };
    }

    const won = await bookingRepository.settleCardCheckout(bookingId, "successful", { transactionCode: transaction.transactionCode });
    if (won) {
      await markBookingPaidOffline(
        String(booking.organizationId),
        bookingId,
        { method: "card", reference: transaction.transactionCode ?? checkout.clientTransactionId, note: `SumUp reader ${checkout.readerName}` },
        { userId: booking.createdByUserId ? String(booking.createdByUserId) : null },
      );
    }
    return { state: "paid", sale: await buildPosSaleResult(bookingId) };
  }

  // FAILED / CANCELLED / REFUNDED: nothing was kept, so release the tickets.
  const status = transaction.status === "CANCELLED" ? "cancelled" : "failed";
  const reason = transaction.status === "CANCELLED" ? "The payment was cancelled." : "The payment was declined.";
  const won = await bookingRepository.settleCardCheckout(bookingId, status, { failureReason: reason });
  if (won) await cancelBooking(bookingId, { reason: `Card payment ${status}` }).catch(() => undefined);
  return status === "cancelled" ? { state: "cancelled" } : { state: "failed", reason };
}

/** Seller backs out while the reader is waiting for the customer. */
export async function cancelSumUpCardSale(organizationId: string, bookingId: string, http: SumUpHttpOptions = {}): Promise<CardSaleState> {
  const booking = await bookingRepository.findById(bookingId);
  const checkout = booking?.cardCheckout;
  if (!booking || !checkout || String(booking.organizationId) !== organizationId) throw ActionError.notFound("Card payment not found");

  if (checkout.status === "waiting") {
    const creds = await resolveCredentials(organizationId);
    await terminateReaderCheckout(creds, checkout.readerId, http).catch(() => undefined);
    // The customer may have paid in the same instant; ask SumUp rather than assume.
    const settled = await settleSumUpCheckout(bookingId, http);
    if (settled.state !== "waiting") return settled;

    const won = await bookingRepository.settleCardCheckout(bookingId, "cancelled", { failureReason: "Cancelled by the seller." });
    if (won) await cancelBooking(bookingId, { reason: "Card payment cancelled by the seller" }).catch(() => undefined);
    return { state: "cancelled" };
  }
  return settleSumUpCheckout(bookingId, http);
}

/** Webhook entry: resolve the booking from the URL token, then verify with SumUp. */
export async function handleSumUpWebhook(token: string, http: SumUpHttpOptions = {}): Promise<void> {
  const booking = await bookingRepository.findByCardCheckoutToken(token);
  if (!booking) throw ActionError.notFound("Unknown checkout");
  await settleSumUpCheckout(String(booking._id), http);
}
