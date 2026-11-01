import { ActionError } from "@tbook/actions";
import { bookingRepository, organizationRepository, VoucherModel, type IBooking } from "@tbook/db";
import type { PaymentMethod } from "@tbook/schemas";
import { buildInvoiceLineItems, resolveBookingVatRates, resolveSupportedInvoiceCurrency, type InvoiceLineItem } from "./invoice-service";
import { readStoredFile } from "./media-storage";
import { decryptOrgSecret } from "./org-secrets";

/**
 * Számlázz.hu receipts (nyugta) for walk-in counter sales: the customer
 * pays and goes straight in, nothing is emailed, and the seller prints the
 * receipt. szamlazz.js only covers invoices, so this talks to the Számla
 * Agent receipt endpoint directly:
 * https://docs.szamlazz.hu/agent/generating_receipt/xml
 *
 * Like invoicing, failures are recorded on the booking (receipt.status =
 * "failed" + error) and never thrown out of the paid-booking pipeline; the
 * seller retries from the sale screen or the booking page.
 */

const AGENT_URL = "https://www.szamlazz.hu/szamla/";

export interface ReceiptRequest {
  agentKey: string;
  /** Receipt number prefix, configured in Settings → Számlázz.hu. */
  prefix: string;
  /** "A" = A4, "N" = 80 mm receipt printer. */
  template: "A" | "N";
  currency: "HUF" | "EUR";
  paymentMethod: PaymentMethod;
  /** Unique per sale; Számlázz.hu refuses a second receipt with the same id (error 338). */
  callId: string;
  items: InvoiceLineItem[];
  note?: string;
}

export interface ReceiptResult {
  number: string;
  pdf: Buffer | null;
}

export interface SzamlazzReceiptProvider {
  createReceipt(request: ReceiptRequest): Promise<ReceiptResult>;
  /** Downloads an issued receipt's PDF again (nyugta_get). */
  downloadReceiptPdf(request: { agentKey: string; number: string; template: "A" | "N" }): Promise<Buffer>;
}

// ---- Pure: XML in, XML out --------------------------------------------------

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Splits a gross line into net + VAT under Számlázz.hu's rounding rules:
 * HUF gross is a whole number, net and VAT have at most 2 decimals, and
 * net + VAT equals gross exactly.
 */
export function splitGross(grossTotal: number, vatPercent: number, currency: "HUF" | "EUR"): { brutto: number; netto: number; afa: number } {
  const brutto = currency === "HUF" ? Math.round(grossTotal) : round2(grossTotal);
  const netto = round2(brutto / (1 + vatPercent / 100));
  const afa = round2(brutto - netto);
  return { brutto, netto, afa };
}

function paymentMethodLabel(method: PaymentMethod): string {
  if (method === "cash") return "készpénz";
  if (method === "card" || method === "stripe") return "bankkártya";
  if (method === "transfer") return "átutalás";
  return "egyéb";
}

/** The `action-szamla_agent_nyugta_create` XML. Element order matters to Számlázz.hu. */
export function buildReceiptXml(request: ReceiptRequest): string {
  const items = request.items
    .map((item) => {
      const { brutto, netto, afa } = splitGross(item.grossUnitPrice * item.quantity, item.vatPercent, request.currency);
      return [
        "    <tetel>",
        `      <megnevezes>${escapeXml(item.label)}</megnevezes>`,
        `      <mennyiseg>${item.quantity}</mennyiseg>`,
        `      <mennyisegiEgyseg>${escapeXml(item.unit)}</mennyisegiEgyseg>`,
        `      <nettoEgysegar>${round2(netto / item.quantity)}</nettoEgysegar>`,
        `      <afakulcs>${item.vatPercent}</afakulcs>`,
        `      <netto>${netto}</netto>`,
        `      <afa>${afa}</afa>`,
        `      <brutto>${brutto}</brutto>`,
        "    </tetel>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmlnyugtacreate xmlns="http://www.szamlazz.hu/xmlnyugtacreate" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlnyugtacreate http://www.szamlazz.hu/docs/xsds/nyugta/xmlnyugtacreate.xsd">',
    "  <beallitasok>",
    `    <szamlaagentkulcs>${escapeXml(request.agentKey)}</szamlaagentkulcs>`,
    "    <pdfLetoltes>true</pdfLetoltes>",
    "  </beallitasok>",
    "  <fejlec>",
    `    <hivasAzonosito>${escapeXml(request.callId)}</hivasAzonosito>`,
    `    <elotag>${escapeXml(request.prefix)}</elotag>`,
    `    <fizmod>${paymentMethodLabel(request.paymentMethod)}</fizmod>`,
    `    <penznem>${request.currency}</penznem>`,
    request.note ? `    <megjegyzes>${escapeXml(request.note)}</megjegyzes>` : null,
    `    <pdfSablon>${request.template}</pdfSablon>`,
    "  </fejlec>",
    "  <tetelek>",
    items,
    "  </tetelek>",
    "</xmlnyugtacreate>",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Reads one element's text, tolerating a namespace prefix. */
function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return match ? match[1]!.trim() : null;
}

/** Parses the `xmlnyugtavalasz` reply into a receipt or a readable error. */
export function parseReceiptResponse(xml: string): ReceiptResult {
  if (tag(xml, "sikeres") !== "true") {
    const code = tag(xml, "hibakod");
    const message = tag(xml, "hibauzenet") ?? "Unknown error";
    if (code === "338") {
      throw new Error("Számlázz.hu already has a receipt for this sale. Look it up in Számlázz.hu (search by the order's call id) before issuing another.");
    }
    throw new Error(`Számlázz.hu error${code ? ` ${code}` : ""}: ${message}`);
  }
  const number = tag(xml, "nyugtaszam");
  if (!number) throw new Error("Számlázz.hu returned no receipt number.");
  const pdfBase64 = tag(xml, "nyugtaPdf");
  return { number, pdf: pdfBase64 ? Buffer.from(pdfBase64.replace(/\s+/g, ""), "base64") : null };
}

export const defaultSzamlazzReceiptProvider: SzamlazzReceiptProvider = {
  async createReceipt(request) {
    const form = new FormData();
    form.append("action-szamla_agent_nyugta_create", new Blob([buildReceiptXml(request)], { type: "text/xml" }), "nyugta.xml");
    const response = await fetch(AGENT_URL, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    const body = await response.text();
    if (!response.ok && !body.includes("sikeres")) throw new Error(`Számlázz.hu responded with HTTP ${response.status}.`);
    return parseReceiptResponse(body);
  },
  async downloadReceiptPdf({ agentKey, number, template }) {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<xmlnyugtaget xmlns="http://www.szamlazz.hu/xmlnyugtaget" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlnyugtaget http://www.szamlazz.hu/docs/xsds/nyugtaget/xmlnyugtaget.xsd">',
      "  <beallitasok>",
      `    <szamlaagentkulcs>${escapeXml(agentKey)}</szamlaagentkulcs>`,
      "    <pdfLetoltes>true</pdfLetoltes>",
      "  </beallitasok>",
      "  <fejlec>",
      `    <nyugtaszam>${escapeXml(number)}</nyugtaszam>`,
      `    <pdfSablon>${template}</pdfSablon>`,
      "  </fejlec>",
      "</xmlnyugtaget>",
    ].join("\n");
    const form = new FormData();
    form.append("action-szamla_agent_nyugta_get", new Blob([xml], { type: "text/xml" }), "nyugta.xml");
    const response = await fetch(AGENT_URL, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    const body = await response.text();
    if (!response.ok && !body.includes("sikeres")) throw new Error(`Számlázz.hu responded with HTTP ${response.status}.`);
    const { pdf } = parseReceiptResponse(body);
    if (!pdf) throw new Error("Számlázz.hu returned no PDF for this receipt.");
    return pdf;
  },
};

// ---- Just-issued PDFs -----------------------------------------------------------

/**
 * Receipt PDFs aren't stored — Számlázz.hu keeps them and returns them on
 * request. The PDF that comes back when a receipt is issued is held in
 * memory for a few minutes, so the "Print receipt" tap right after the
 * sale is instant and doesn't depend on a second call.
 */
const RECENT_TTL_MS = 15 * 60 * 1000;
const RECENT_MAX = 100;
const recentPdfs = new Map<string, { pdf: Buffer; at: number }>();

function rememberPdf(organizationId: string, number: string, pdf: Buffer): void {
  recentPdfs.set(`${organizationId}:${number}`, { pdf, at: Date.now() });
  if (recentPdfs.size > RECENT_MAX) recentPdfs.delete(recentPdfs.keys().next().value!);
}

function recentPdf(organizationId: string, number: string): Buffer | null {
  const hit = recentPdfs.get(`${organizationId}:${number}`);
  if (!hit || Date.now() - hit.at > RECENT_TTL_MS) return null;
  return hit.pdf;
}

/**
 * A receipt's PDF for printing: just-issued copy, else a legacy file from
 * before PDFs stopped being stored, else downloaded from Számlázz.hu.
 */
export async function fetchReceiptPdf(
  organizationId: string,
  receipt: { number: string | null; pdfFileName?: string | null },
  provider: SzamlazzReceiptProvider = defaultSzamlazzReceiptProvider,
): Promise<Buffer> {
  if (!receipt.number) throw ActionError.notFound("This sale has no receipt yet.");
  const recent = recentPdf(organizationId, receipt.number);
  if (recent) return recent;
  if (receipt.pdfFileName) {
    const legacy = await readStoredFile(receipt.pdfFileName);
    if (legacy) return legacy;
  }
  const org = await organizationRepository.findById(organizationId);
  const agentKey = decryptOrgSecret(org?.settings?.szamlazz?.agentKeyEnc);
  if (!agentKey) throw ActionError.validation("The Számlázz.hu agent key is missing — re-save it in Settings to reprint receipts.");
  try {
    const pdf = await provider.downloadReceiptPdf({
      agentKey,
      number: receipt.number,
      template: org?.settings?.szamlazz?.receiptTemplate === "N" ? "N" : "A",
    });
    rememberPdf(organizationId, receipt.number, pdf);
    return pdf;
  } catch (error) {
    throw ActionError.conflict(
      `Couldn't get receipt ${receipt.number} from Számlázz.hu: ${error instanceof Error ? error.message : "unknown error"}. Try again in a moment.`,
      "receipt_unavailable",
    );
  }
}

// ---- Orchestration -----------------------------------------------------------

export interface ReceiptDocumentInput {
  items: InvoiceLineItem[];
  paymentMethod: PaymentMethod;
  /** Unique per sale (Számlázz.hu's hivasAzonosito). */
  callId: string;
  currency: string | null | undefined;
  note?: string;
}

/**
 * Issues one Számlázz.hu receipt for an organization. The PDF isn't
 * stored (see fetchReceiptPdf); it's kept in memory briefly for printing.
 * Shared by walk-in ticket sales and merch sales. Throws a readable Error
 * when the organization isn't set up or Számlázz.hu refuses.
 */
export async function issueReceiptDocument(
  organizationId: string | null,
  input: ReceiptDocumentInput,
  provider: SzamlazzReceiptProvider = defaultSzamlazzReceiptProvider,
): Promise<{ number: string }> {
  const org = organizationId ? await organizationRepository.findById(organizationId) : null;
  const szamlazz = org?.settings?.szamlazz;
  if (!szamlazz?.enabled) throw new Error("Számlázz.hu is not enabled — turn it on in Settings → Payments & integrations.");
  const agentKey = decryptOrgSecret(szamlazz.agentKeyEnc);
  if (!agentKey) throw new Error("The Számlázz.hu agent key is missing — re-save it in Settings.");
  const currency = resolveSupportedInvoiceCurrency(input.currency);
  if (!currency) throw new Error(`Számlázz.hu receipts support HUF and EUR only (this sale is in ${input.currency}).`);
  if (input.items.length === 0) throw new Error("This sale has nothing to put on a receipt (total is zero).");

  const result = await provider.createReceipt({
    agentKey,
    prefix: szamlazz.receiptPrefix?.trim() || "NYGTA",
    template: szamlazz.receiptTemplate === "N" ? "N" : "A",
    currency,
    paymentMethod: input.paymentMethod,
    callId: input.callId,
    items: input.items,
    note: input.note,
  });
  if (result.pdf && organizationId) rememberPdf(organizationId, result.number, result.pdf);
  return { number: result.number };
}

/**
 * Issues the receipt for a paid walk-in ticket sale. Idempotent: an issued
 * receipt is never re-issued. Never throws; the outcome is on booking.receipt.
 */
export async function issueReceiptForBooking(bookingId: string, opts?: { provider?: SzamlazzReceiptProvider }): Promise<void> {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking || booking.receipt?.status === "issued") return;

  const setReceipt = (receipt: Record<string, unknown>) =>
    bookingRepository.updateById(bookingId, { receipt: { number: null, pdfFileName: null, error: null, issuedAt: null, ...receipt } } as never);

  await setReceipt({ status: "pending" });
  try {
    const { number } = await issueReceiptDocument(
      booking.organizationId ? String(booking.organizationId) : null,
      {
        items: buildInvoiceLineItems(booking, await resolveBookingVatRates(booking)),
        paymentMethod: booking.paymentMethod,
        callId: `tbook-${bookingId}`,
        currency: booking.currency,
        note: booking.eventName,
      },
      opts?.provider,
    );
    await setReceipt({ status: "issued", number, issuedAt: new Date() });
  } catch (error) {
    await setReceipt({ status: "failed", error: error instanceof Error ? error.message : "Receipt issuance failed." });
  }
}

/**
 * Walk-in customers are admitted at the counter, so their entries are
 * checked in as part of the sale — the door count stays right and nobody
 * is left "outstanding".
 */
export async function checkInWalkInEntries(bookingId: string, userId: string | null = null): Promise<number> {
  const result = await VoucherModel.updateMany(
    { bookingId, status: "active" },
    { $set: { status: "checked_in", checkedInAt: new Date(), checkedInByUserId: userId } },
  ).exec();
  return result.modifiedCount;
}

/** A walk-in booking's receipt PDF, for printing. */
export async function getReceiptPdfForOrg(
  organizationId: string,
  bookingId: string,
  provider?: SzamlazzReceiptProvider,
): Promise<{ pdf: Buffer; number: string } | null> {
  const booking: IBooking | null = await bookingRepository.findById(bookingId);
  if (!booking || String(booking.organizationId) !== organizationId) throw ActionError.notFound("Booking not found");
  if (booking.receipt?.status !== "issued" || !booking.receipt.number) return null;
  return { pdf: await fetchReceiptPdf(organizationId, booking.receipt, provider), number: booking.receipt.number };
}
