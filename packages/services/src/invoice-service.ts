import type { PaymentMethod } from "@tbook/schemas";
import { bookingRepository, eventRepository, hotelRepository, organizationRepository, type IBooking } from "@tbook/db";
import { AFTER_BOOKING_PAID_HOOKS } from "./checkout-service";
import { sendMail, type MailTransporter } from "./mailer";
import { storeFile } from "./media-storage";
import { decryptOrgSecret } from "./org-secrets";

/**
 * Ported from the legacy plugin's services/invoice-service.ts (Számlázz.hu
 * Hungarian e-invoicing). Deliberate change vs. the legacy version, per the
 * approved plan: the legacy adapted a booking into a generic core `IOrder`
 * shape consumed by a shared `InvoicingSzamlazzService` — this rewrite has
 * no shop plugin/generic Order model, so this file owns invoicing for tBook
 * bookings end to end, using the same `szamlazz.js` SDK the legacy system
 * uses (its XML wire protocol is non-trivial and already correctly
 * implemented there — reimplementing it via raw fetch would risk a subtly
 * broken client for a niche regional API with no easy way to verify
 * correctness in this pass; this file's own logic — VAT resolution, line
 * mapping, credential resolution, idempotency, error handling — is what's
 * actually novel here and is fully unit-tested without any network access).
 *
 * Deferred: invoice reversal (reverseBookingInvoice), guest PDF download,
 * and invoice-email delivery (deliverInvoiceEmailIfNeeded — no mailer
 * exists yet in this rewrite). PDF storage is a TODO: the follow-up pass
 * that wires real media storage for voucher PDFs should wire invoice PDF
 * storage at the same time (see voucher-service.ts's equivalent note).
 */

// ---------------------------------------------------------------------------
// Pure logic (no I/O) — VAT-per-line resolution, line-item mapping, currency.
// ---------------------------------------------------------------------------

/**
 * Re-derives VAT per quote line by key prefix. Ported as-is from the legacy
 * `vatForQuoteLine` — a known-fragile-but-functional pattern (string
 * matching against the pricing engine's internal key-naming convention)
 * that isn't redesigned in this pass.
 */
export function vatForQuoteLine(lineKey: string, ticketVatPercent: number, accommodationVatPercent: number): number {
  if (lineKey === "accommodation_base" || lineKey.startsWith("package") || lineKey.startsWith("option:")) {
    return accommodationVatPercent;
  }
  return ticketVatPercent;
}

export interface InvoiceLineItem {
  label: string;
  quantity: number;
  unit: string;
  vatPercent: number;
  grossUnitPrice: number;
}

/** Maps a booking's price-quote lines (positive amounts only) to invoice line items. */
export function buildInvoiceLineItems(
  booking: Pick<IBooking, "quote">,
  vat: { ticketVatPercent: number; accommodationVatPercent: number },
): InvoiceLineItem[] {
  return booking.quote.lines
    .filter((line) => line.amountHuf > 0)
    .map((line) => ({
      label: line.label,
      quantity: 1,
      unit: "db",
      vatPercent: vatForQuoteLine(line.key, vat.ticketVatPercent, vat.accommodationVatPercent),
      grossUnitPrice: line.amountHuf,
    }));
}

export type SupportedInvoiceCurrency = "HUF" | "EUR";

/** The Számlázz.hu integration only supports HUF/EUR bookings — port of the legacy restriction. */
export function resolveSupportedInvoiceCurrency(currency: string | null | undefined): SupportedInvoiceCurrency | null {
  const code = String(currency ?? "HUF")
    .trim()
    .toUpperCase();
  return code === "HUF" || code === "EUR" ? code : null;
}

// ---------------------------------------------------------------------------
// Credentials — org-level only, no platform fallback (each org invoices in
// its own name/tax details).
// ---------------------------------------------------------------------------

export interface SzamlazzCredentials {
  agentKey: string;
  sellerName: string;
  sellerBank: string;
  sellerBankAccount: string;
}

export type ResolveOrgSzamlazzResult =
  | { status: "ready"; credentials: SzamlazzCredentials }
  | { status: "disabled"; message: string }
  | { status: "not_configured"; message: string };

export async function resolveOrgSzamlazzCredentials(organizationId: string | null | undefined): Promise<ResolveOrgSzamlazzResult> {
  if (!organizationId) {
    return { status: "not_configured", message: "Invoicing requires the booking to belong to an organization." };
  }
  const org = await organizationRepository.findById(organizationId);
  const szamlazz = org?.settings?.szamlazz;
  if (!szamlazz?.enabled) {
    return { status: "disabled", message: "Invoicing is not configured — enable Számlázz.hu in Organization settings and save an agent key." };
  }
  const agentKey = decryptOrgSecret(szamlazz.agentKeyEnc);
  if (!agentKey) {
    return { status: "not_configured", message: "Számlázz.hu agent key is missing or could not be decrypted — re-save it in Organization settings." };
  }
  return {
    status: "ready",
    credentials: {
      agentKey,
      sellerName: szamlazz.sellerName ?? "",
      sellerBank: szamlazz.sellerBank ?? "",
      sellerBankAccount: szamlazz.sellerBankAccount ?? "",
    },
  };
}

// ---------------------------------------------------------------------------
// Provider — the actual Számlázz.hu SDK call, injectable for tests (no
// network access is ever made from a unit test).
// ---------------------------------------------------------------------------

export interface InvoiceBuyer {
  name: string;
  country: string;
  zip: string;
  city: string;
  address: string;
  taxNumber: string;
  phone: string;
}

export interface IssueInvoiceInput {
  currency: SupportedInvoiceCurrency;
  credentials: SzamlazzCredentials;
  buyer: InvoiceBuyer;
  items: InvoiceLineItem[];
  orderNumber: string;
  /** How the buyer paid; drives the "fizetési mód" printed on the invoice. Defaults to card. */
  paymentMethod?: PaymentMethod;
}

export interface IssueInvoiceOutput {
  invoiceId: string;
  pdfBuffer?: Buffer | null;
}

export interface SzamlazzInvoiceProvider {
  issueInvoice(input: IssueInvoiceInput): Promise<IssueInvoiceOutput>;
}

/** Real provider — dynamically imports szamlazz.js so it's never loaded (or network-reached) during tests. */
export const defaultSzamlazzProvider: SzamlazzInvoiceProvider = {
  async issueInvoice(input) {
    const { Buyer, Client, Currencies, Invoice, Item, Languages, PaymentMethods, Seller } = await import("szamlazz.js");

    const client = new Client({
      authToken: input.credentials.agentKey,
      eInvoice: true,
      requestInvoiceDownload: true,
      downloadedInvoiceCount: 1,
      responseVersion: 1,
      timeout: 10_000,
    });

    const invoice = new Invoice({
      paymentMethod:
        input.paymentMethod === "cash"
          ? PaymentMethods.Cash
          : input.paymentMethod === "transfer"
            ? PaymentMethods.BankTransfer
            : PaymentMethods.CreditCard,
      currency: input.currency === "EUR" ? Currencies.EUR : Currencies.HUF,
      language: input.currency === "EUR" ? Languages.English : Languages.Hungarian,
      seller: new Seller({
        bank: { name: input.credentials.sellerBank, accountNumber: input.credentials.sellerBankAccount },
        issuerName: input.credentials.sellerName,
      }),
      buyer: new Buyer({
        name: input.buyer.name,
        country: input.buyer.country,
        zip: input.buyer.zip,
        city: input.buyer.city,
        address: input.buyer.address,
        taxNumber: input.buyer.taxNumber,
        phone: input.buyer.phone,
      }),
      items: input.items.map(
        (item) => new Item({ label: item.label, quantity: item.quantity, unit: item.unit, vat: item.vatPercent, grossUnitPrice: item.grossUnitPrice }),
      ),
      orderNumber: input.orderNumber,
    });

    const response = (await client.issueInvoice(invoice)) as { invoiceId?: string; pdf?: Buffer };
    const invoiceId = String(response.invoiceId || "");
    if (!invoiceId) throw new Error("Számlázz.hu returned no invoice id.");
    return { invoiceId, pdfBuffer: Buffer.isBuffer(response.pdf) ? response.pdf : null };
  },
};

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget after payment; failures are recorded on the booking for
 * admin retry, never thrown. Idempotent — already-issued invoices are a
 * no-op (email delivery is deferred, see file header).
 */
export async function issueInvoiceForBooking(
  bookingId: string,
  opts?: { provider?: SzamlazzInvoiceProvider; transporter?: MailTransporter },
): Promise<void> {
  const provider = opts?.provider ?? defaultSzamlazzProvider;
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) return;
  if (booking.invoiceStatus === "issued") return;

  const organizationId = booking.organizationId ? String(booking.organizationId) : null;
  const credsResult = await resolveOrgSzamlazzCredentials(organizationId);
  if (credsResult.status !== "ready") {
    await bookingRepository.updateById(bookingId, {
      invoiceStatus: credsResult.status === "disabled" ? "none" : "failed",
      invoiceError: credsResult.message,
    });
    return;
  }

  const currency = resolveSupportedInvoiceCurrency(booking.currency);
  if (!currency) {
    await bookingRepository.updateById(bookingId, {
      invoiceStatus: "failed",
      invoiceError: `The Számlázz.hu integration only supports HUF and EUR (booking currency: ${booking.currency}).`,
    });
    return;
  }

  if (!booking.billing) {
    await bookingRepository.updateById(bookingId, { invoiceStatus: "failed", invoiceError: "Missing billing address — cannot issue invoice." });
    return;
  }

  await bookingRepository.updateById(bookingId, { invoiceStatus: "pending", invoiceError: null });

  try {
    const event = await eventRepository.findById(String(booking.eventId));
    const ticketVatPercent = typeof event?.ticketVatPercent === "number" ? event.ticketVatPercent : 27;
    let accommodationVatPercent = ticketVatPercent;
    if (booking.hotelId) {
      const hotel = await hotelRepository.findById(String(booking.hotelId));
      if (typeof hotel?.pricing?.vatPercent === "number") accommodationVatPercent = hotel.pricing.vatPercent;
    }

    const items = buildInvoiceLineItems(booking, { ticketVatPercent, accommodationVatPercent });
    const result = await provider.issueInvoice({
      currency,
      credentials: credsResult.credentials,
      buyer: {
        name: booking.billing.name,
        country: booking.billing.countryCode || "HU",
        zip: booking.billing.zip,
        city: booking.billing.city,
        address: booking.billing.street,
        taxNumber: booking.billing.taxNumber || "",
        phone: booking.customer.phone,
      },
      items,
      orderNumber: String(booking._id),
      paymentMethod: booking.paymentMethod,
    });

    const invoicePdfFileName = result.pdfBuffer ? (await storeFile(result.pdfBuffer, { subdir: "invoices", fileName: `${result.invoiceId}.pdf` })).url : null;

    await bookingRepository.updateById(bookingId, {
      invoiceStatus: "issued",
      invoiceId: result.invoiceId,
      invoicePdfFileName,
      invoiceError: null,
    });

    await emailInvoiceIfNeeded(bookingId, organizationId, result.pdfBuffer ?? null, opts?.transporter);
  } catch (error) {
    await bookingRepository.updateById(bookingId, {
      invoiceStatus: "failed",
      invoiceError: error instanceof Error ? error.message : "Invoice issuance failed.",
    });
  }
}

/**
 * Emails the invoice PDF to the customer, for bookings made at the counter
 * or in the console. Storefront bookings are left alone: that flow already
 * had its own customer communication before this existed, and sending here
 * would double it. Never throws — a mail failure must not flip an issued
 * invoice back to "failed".
 */
async function emailInvoiceIfNeeded(
  bookingId: string,
  organizationId: string | null,
  pdf: Buffer | null,
  transporter?: MailTransporter,
): Promise<void> {
  try {
    const booking = await bookingRepository.findById(bookingId);
    if (!booking || !pdf || booking.invoiceEmailSentAt) return;
    if ((booking.source ?? "storefront") === "storefront") return;

    await sendMail(
      organizationId,
      {
        to: booking.customer.email,
        subject: `Invoice for ${booking.eventName}`,
        html: `<p>Hi ${booking.customer.name},</p><p>Thank you for your purchase of <strong>${booking.eventName}</strong>. Your invoice is attached.</p>`,
        attachments: [{ filename: `invoice-${booking.invoiceId ?? bookingId}.pdf`, content: pdf, contentType: "application/pdf" }],
      },
      transporter,
    );
    await bookingRepository.updateById(bookingId, { invoiceEmailSentAt: new Date() });
  } catch (error) {
    console.error("[tbook] invoice email failed", bookingId, error);
  }
}

/** Registered into checkout-service's AFTER_BOOKING_PAID_HOOKS below — no platform fallback, so orgless bookings are skipped. */
export async function invoiceAfterBookingPaidHook(booking: IBooking): Promise<void> {
  if (!booking.organizationId) return;
  await issueInvoiceForBooking(String(booking._id));
}

AFTER_BOOKING_PAID_HOOKS.push(invoiceAfterBookingPaidHook);
