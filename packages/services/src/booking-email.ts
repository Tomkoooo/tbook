import {
  describeBookingEmailAttachments,
  renderBookingEmail,
  resolveBookingEmailTemplate,
  type BookingEmailValues,
} from "@tbook/domain";
import { ActionError } from "@tbook/actions";
import { bookingRepository, eventRepository, organizationRepository, voucherRepository, type IBooking } from "@tbook/db";
import { WALK_IN_CUSTOMER_EMAIL } from "@tbook/schemas";
import { AFTER_BOOKING_PAID_HOOKS } from "./checkout-service";
import { extensions } from "./extensions";
import { getInvoicePdfForBooking, issueInvoiceForBooking, type SzamlazzInvoiceProvider } from "./invoice-service";
import { sendMail, type MailTransporter, type SendMailInput } from "./mailer";
import { checkInWalkInEntries, issueReceiptForBooking } from "./receipt-service";
import { renderVoucherPdfForBooking, type RenderVoucherPdfOptions } from "./voucher-pdf-email";

/**
 * The one customer email for a paid booking: the org's confirmation text
 * (editable in the console, see @tbook/domain booking-email), with the
 * ticket PDF and the invoice PDF attached when they exist. Replaces the
 * separate ticket and invoice mails, so a guest gets a single message.
 */

export interface SendBookingEmailOptions extends RenderVoucherPdfOptions {
  /** Test seam — see mailer.ts. Defaults to a real nodemailer transport. */
  transporter?: MailTransporter;
  /** Send somewhere other than the booking's own email (admin "re-send"). */
  toEmail?: string;
  /** The invoice PDF if the caller already has it (just issued), saving a download. */
  invoicePdf?: Buffer | null;
  /** Test seam for downloading the invoice from Számlázz.hu. */
  invoiceProvider?: SzamlazzInvoiceProvider;
}

export interface SendBookingEmailResult {
  to: string;
  /** Number of tickets attached (0 when the event issues none). */
  ticketCount: number;
  invoiceAttached: boolean;
}

function formatMoney(amount: number, currency: string): string {
  return `${new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(amount)} ${currency}`;
}

function formatDate(date: Date | null | undefined): string {
  return date ? new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium", timeZone: "Europe/Budapest" }).format(date) : "";
}

/** Builds the placeholder values for one booking. Exported for tests and previews. */
export async function bookingEmailValues(
  booking: IBooking,
  extra: { ticketCount: number; hasInvoice: boolean; organizationName: string },
): Promise<BookingEmailValues> {
  const event = booking.eventId ? await eventRepository.findById(String(booking.eventId)) : null;
  return {
    customerName: booking.customer?.name ?? "",
    eventName: booking.eventName,
    eventDate: formatDate(event?.startDate ?? null),
    guests: booking.guests,
    total: formatMoney(booking.totalHuf, booking.currency ?? "HUF"),
    bookingId: String(booking._id),
    organizationName: extra.organizationName,
    attachments: describeBookingEmailAttachments(extra.ticketCount, extra.hasInvoice),
  };
}

/**
 * Renders the ticket PDF (if the booking has vouchers), picks up the
 * stored invoice PDF (if one was issued), and sends the combined email.
 * Throws on a mail failure so the admin "re-send" can report it; the paid
 * hook below catches.
 */
export async function sendBookingEmail(bookingId: string, opts: SendBookingEmailOptions = {}): Promise<SendBookingEmailResult | null> {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) return null;

  const organizationId = booking.organizationId ? String(booking.organizationId) : null;
  const org = organizationId ? await organizationRepository.findById(organizationId) : null;

  const ticket = await renderVoucherPdfForBooking(bookingId, { loadFont: opts.loadFont });
  // Invoices aren't stored: use the one just issued, else fetch it. A failed
  // download doesn't stop the email — invoiceEmailSentAt stays empty, so the
  // console shows the invoice wasn't sent and it can be re-sent.
  const invoicePdf =
    opts.invoicePdf ??
    (await getInvoicePdfForBooking(booking, { provider: opts.invoiceProvider }).catch((error) => {
      console.error("[tbook] invoice PDF download failed", bookingId, error);
      return null;
    }));

  const attachments: NonNullable<SendMailInput["attachments"]> = [];
  if (ticket) {
    attachments.push({
      filename: `${booking.eventName.replace(/[^\w.-]+/g, "_")}.pdf`,
      content: Buffer.from(ticket.bytes),
      contentType: "application/pdf",
    });
  }
  if (invoicePdf) {
    attachments.push({
      filename: `invoice-${booking.invoiceId ?? bookingId}.pdf`,
      content: invoicePdf,
      contentType: "application/pdf",
    });
  }

  const templates = org?.settings?.emailTemplates;
  // voucherDelivery is the old ticket-only template; still honoured so an
  // org's existing custom text isn't lost.
  const template = resolveBookingEmailTemplate(templates?.bookingConfirmation, templates?.voucherDelivery);
  const values = await bookingEmailValues(booking, {
    ticketCount: ticket?.voucherCount ?? 0,
    hasInvoice: Boolean(invoicePdf),
    organizationName: org?.name ?? "",
  });
  const rendered = renderBookingEmail(template, values);

  const to = opts.toEmail?.trim() || booking.customer.email;
  if (to === WALK_IN_CUSTOMER_EMAIL) {
    throw ActionError.validation("This was a walk-in sale with no email address. Enter the address to send it to.");
  }
  await sendMail(organizationId, { to, subject: rendered.subject, html: rendered.body, attachments, test: booking.isTest }, opts.transporter);

  if (ticket) await voucherRepository.markEmailedForBooking(bookingId, to, booking.customer.name);
  if (invoicePdf) await bookingRepository.updateById(bookingId, { invoiceEmailSentAt: new Date() });

  return { to, ticketCount: ticket?.voucherCount ?? 0, invoiceAttached: Boolean(invoicePdf) };
}

/**
 * The paid-booking documents step, as one hook so the order is explicit:
 * issue the invoice first, then send the single email carrying it — or,
 * for a walk-in sale, issue the printable receipt instead.
 * Voucher rows were already created by afterBookingPaid before hooks run.
 */
export async function bookingDocumentsAfterBookingPaidHook(booking: IBooking): Promise<void> {
  const bookingId = String(booking._id);
  // Walk-in counter sale: nothing is emailed. The customer gets a printed
  // receipt and goes straight in, so their entries are checked in now.
  if (booking.delivery === "receipt") {
    try {
      await checkInWalkInEntries(bookingId, booking.createdByUserId ? String(booking.createdByUserId) : null);
    } catch (error) {
      console.error("[tbook] walk-in check-in failed", bookingId, error);
    }
    await issueReceiptForBooking(bookingId);
    return;
  }
  let invoicePdf: Buffer | null = null;
  // A test booking (v1 X-TBook-Test) gets its emails but never an invoice.
  if (booking.organizationId && !booking.isTest) {
    try {
      invoicePdf = await issueInvoiceForBooking(bookingId);
    } catch (error) {
      console.error("[tbook] invoice issuance failed", bookingId, error);
    }
  }
  // A module that sends its own confirmation (per-attendee emails, …) asks
  // for the default one to be skipped, so the guest doesn't get two.
  for (const suppressor of extensions.bookingEmailSuppressors()) {
    try {
      if (await suppressor(booking)) return;
    } catch (error) {
      console.error("[tbook] booking email suppressor failed", bookingId, error);
    }
  }
  try {
    await sendBookingEmail(bookingId, { invoicePdf });
  } catch (error) {
    console.error("[tbook] booking email failed", bookingId, error);
  }
}

AFTER_BOOKING_PAID_HOOKS.push(bookingDocumentsAfterBookingPaidHook);
