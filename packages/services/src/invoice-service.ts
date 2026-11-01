import type { PaymentMethod } from "@tbook/schemas";
import { bookingRepository, eventRepository, hotelRepository, organizationRepository, type IBooking } from "@tbook/db";
import { getOwnedBlob } from "./blob-store";
import { readStoredFile } from "./media-storage";
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
 * Deferred: invoice reversal (reverseBookingInvoice) and guest PDF
 * download. The issued PDF is stored via media-storage and emailed to the
 * guest inside the combined booking email (booking-email.ts).
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

/** VAT rates for a booking's lines: the event's ticket VAT, and the hotel's for accommodation (falls back to the ticket VAT). */
export async function resolveBookingVatRates(
  booking: Pick<IBooking, "eventId" | "hotelId">,
): Promise<{ ticketVatPercent: number; accommodationVatPercent: number }> {
  const event = await eventRepository.findById(String(booking.eventId));
  const ticketVatPercent = typeof event?.ticketVatPercent === "number" ? event.ticketVatPercent : 27;
  let accommodationVatPercent = ticketVatPercent;
  if (booking.hotelId) {
    const hotel = await hotelRepository.findById(String(booking.hotelId));
    if (typeof hotel?.pricing?.vatPercent === "number") accommodationVatPercent = hotel.pricing.vatPercent;
  }
  return { ticketVatPercent, accommodationVatPercent };
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
  /** Downloads an issued invoice's PDF by its number (Számla Agent `szamla_agent_pdf`). */
  downloadInvoicePdf(input: { agentKey: string; invoiceNumber: string }): Promise<Buffer>;
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

  async downloadInvoicePdf({ agentKey, invoiceNumber }) {
    const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // valaszVerzio 2: XML reply with the PDF in base64 (element order is fixed by the XSD).
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<xmlszamlapdf xmlns="http://www.szamlazz.hu/xmlszamlapdf" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlapdf https://www.szamlazz.hu/szamla/docs/xsds/agentpdf/xmlszamlapdf.xsd">',
      `  <szamlaagentkulcs>${escape(agentKey)}</szamlaagentkulcs>`,
      `  <szamlaszam>${escape(invoiceNumber)}</szamlaszam>`,
      "  <valaszVerzio>2</valaszVerzio>",
      "</xmlszamlapdf>",
    ].join("\n");
    const form = new FormData();
    form.append("action-szamla_agent_pdf", new Blob([xml], { type: "text/xml" }), "szamla.xml");
    const response = await fetch("https://www.szamlazz.hu/szamla/", { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, 4).toString("latin1") === "%PDF") return bytes;
    const body = bytes.toString("utf8");
    const tag = (name: string) => new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(body)?.[1]?.trim() ?? null;
    const pdf = tag("pdf");
    if (pdf) return Buffer.from(pdf.replace(/\s+/g, ""), "base64");
    const error = response.headers.get("szlahu_error") ?? tag("hibauzenet") ?? `HTTP ${response.status}`;
    throw new Error(`Számlázz.hu: ${decodeURIComponent(error)}`);
  },
};

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget after payment; failures are recorded on the booking for
 * admin retry, never thrown. Idempotent — already-issued invoices are a
 * no-op. Does not email: the PDF is attached to the single booking email
 * (booking-email.ts), which runs right after this.
 */
/**
 * Returns the PDF Számlázz.hu sent back when this call issued the invoice
 * (null otherwise), so the booking email can attach it without a second
 * download. Nothing is stored — see getInvoicePdfForBooking.
 */
export async function issueInvoiceForBooking(
  bookingId: string,
  opts?: { provider?: SzamlazzInvoiceProvider },
): Promise<Buffer | null> {
  const provider = opts?.provider ?? defaultSzamlazzProvider;
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) return null;
  if (booking.invoiceStatus === "issued") return null;

  const organizationId = booking.organizationId ? String(booking.organizationId) : null;
  const credsResult = await resolveOrgSzamlazzCredentials(organizationId);
  if (credsResult.status !== "ready") {
    await bookingRepository.updateById(bookingId, {
      invoiceStatus: credsResult.status === "disabled" ? "none" : "failed",
      invoiceError: credsResult.message,
    });
    return null;
  }

  const currency = resolveSupportedInvoiceCurrency(booking.currency);
  if (!currency) {
    await bookingRepository.updateById(bookingId, {
      invoiceStatus: "failed",
      invoiceError: `The Számlázz.hu integration only supports HUF and EUR (booking currency: ${booking.currency}).`,
    });
    return null;
  }

  if (!booking.billing) {
    await bookingRepository.updateById(bookingId, { invoiceStatus: "failed", invoiceError: "Missing billing address — cannot issue invoice." });
    return null;
  }

  await bookingRepository.updateById(bookingId, { invoiceStatus: "pending", invoiceError: null });

  try {
    const items = buildInvoiceLineItems(booking, await resolveBookingVatRates(booking));
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

    await bookingRepository.updateById(bookingId, {
      invoiceStatus: "issued",
      invoiceId: result.invoiceId,
      invoiceError: null,
    });
    return result.pdfBuffer ?? null;
  } catch (error) {
    await bookingRepository.updateById(bookingId, {
      invoiceStatus: "failed",
      invoiceError: error instanceof Error ? error.message : "Invoice issuance failed.",
    });
    return null;
  }
}

/**
 * An issued invoice's PDF, from wherever it lives:
 *   1. a manually attached PDF (blob store),
 *   2. a legacy file from before invoice PDFs stopped being stored,
 *   3. Számlázz.hu, which keeps every invoice and returns it by number.
 * Null when there is no invoice or no way to get it.
 */
export async function getInvoicePdfForBooking(
  booking: IBooking,
  opts?: { provider?: SzamlazzInvoiceProvider },
): Promise<Buffer | null> {
  if (booking.invoiceStatus !== "issued") return null;
  const organizationId = booking.organizationId ? String(booking.organizationId) : null;

  if (booking.invoicePdfBlobId && organizationId) {
    const blob = await getOwnedBlob(organizationId, booking.invoicePdfBlobId, "invoice");
    if (blob) return blob.data;
  }
  if (booking.invoicePdfFileName) {
    const legacy = await readStoredFile(booking.invoicePdfFileName);
    if (legacy) return legacy;
  }
  if ((booking.invoiceSource ?? "szamlazz") !== "szamlazz" || !booking.invoiceId) return null;

  const creds = await resolveOrgSzamlazzCredentials(organizationId);
  if (creds.status !== "ready") return null;
  return (opts?.provider ?? defaultSzamlazzProvider).downloadInvoicePdf({ agentKey: creds.credentials.agentKey, invoiceNumber: booking.invoiceId });
}
