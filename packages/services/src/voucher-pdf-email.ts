import { bookingRepository, eventGroupRepository, eventRepository, organizationRepository, voucherRepository, type IBooking, type IVoucher } from "@tbook/db";
import { AFTER_BOOKING_PAID_HOOKS } from "./checkout-service";
import { storeFile } from "./media-storage";
import { sendMail } from "./mailer";
import { buildVoucherPdf, type VoucherPdfPageInput } from "./voucher-pdf";

/**
 * Renders the voucher PDF (using the org's fully-customizable layout, or
 * the shipped default), stores it, stamps each voucher row's
 * `pdfFileName`, and emails it to the customer. Kept separate from
 * voucher-service.ts's pure row-creation logic (issueVoucherRowsForBooking)
 * on purpose — that function stays testable without any rendering/
 * storage/network concerns; this file is the side-effecting orchestration
 * on top of it, registered into checkout-service's AFTER_BOOKING_PAID_HOOKS
 * the same way invoice-service/tdarts-sync-service already are.
 *
 * Deferred: header images are only resolved from an absolute http(s) URL
 * (fetched at render time) — there's no general internal media-upload
 * feature in this repo yet for an admin to host a header image locally;
 * once one exists, extend `resolveHeaderImageBytes` to also read from
 * media-storage.ts.
 */

async function resolveHeaderImageBytes(url: string): Promise<{ bytes: Uint8Array; isPng: boolean } | null> {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null;
  try {
    const res = await fetch(trimmed);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const isPng = trimmed.toLowerCase().includes(".png") || bytes[0] === 0x89;
    return { bytes, isPng };
  } catch {
    return null;
  }
}

async function resolveHeaderImageUrl(booking: IBooking): Promise<string> {
  const event = await eventRepository.findById(String(booking.eventId));
  if (event?.voucherHeaderImage) return event.voucherHeaderImage;
  if (event?.groupId) {
    const group = await eventGroupRepository.findById(String(event.groupId));
    if (group?.voucherHeaderImage) return group.voucherHeaderImage;
  }
  return "";
}

function toPageInput(voucher: IVoucher, booking: IBooking): VoucherPdfPageInput {
  return {
    token: voucher.token,
    displayName: voucher.displayName,
    attendeeFields: voucher.attendeeFields,
    attendeeFieldSchema: booking.attendeeFieldSchema,
    eventName: voucher.eventSnapshot.name,
    startDate: voucher.eventSnapshot.startDate,
    endDate: voucher.eventSnapshot.endDate,
    startTime: voucher.eventSnapshot.startTime,
    endTime: voucher.eventSnapshot.endTime,
    locationAddress: voucher.eventSnapshot.locationAddress,
    bookingId: String(booking._id),
  };
}

function defaultVoucherEmailHtml(booking: IBooking, voucherCount: number): string {
  const guestLabel = voucherCount === 1 ? "your ticket" : `your ${voucherCount} tickets`;
  return `<p>Hi ${booking.customer.name},</p><p>Thanks for booking <strong>${booking.eventName}</strong> — please find ${guestLabel} attached as a PDF. Show the QR code at check-in.</p>`;
}

export interface IssueVoucherPdfAndEmailOptions {
  /** Test seam — see buildVoucherPdf's loadFont param. Defaults to the vendored local font. */
  loadFont?: () => Promise<Uint8Array>;
  /** Test seam — see mailer.ts's MailTransporter param. Defaults to a real nodemailer transport. */
  transporter?: Parameters<typeof sendMail>[2];
  /**
   * Send to an address other than the booking's own customer email.
   * Exists for the admin "re-send entries" action (a guest who lost the
   * mail, or asks for it at a different address); the paid-booking hook
   * never passes it, so the default path is unchanged.
   */
  toEmail?: string;
}

/**
 * Renders + stores the voucher PDF for an already-issued booking's
 * vouchers, updates their pdfFileName, and emails the customer. No-op
 * (returns null) if the booking has no vouchers yet — call after
 * issueVoucherRowsForBooking. Never throws past its own boundary; the
 * caller (afterBookingPaid) must be able to rely on that.
 */
export async function issueVoucherPdfAndEmail(bookingId: string, opts: IssueVoucherPdfAndEmailOptions = {}): Promise<string | null> {
  const [booking, vouchers] = await Promise.all([bookingRepository.findById(bookingId), voucherRepository.findByBookingId(bookingId)]);
  if (!booking || vouchers.length === 0) return null;

  const organizationId = booking.organizationId ? String(booking.organizationId) : null;
  const org = organizationId ? await organizationRepository.findById(organizationId) : null;
  const layout = org?.settings?.voucherPdfLayout ?? null;

  const headerImageUrl = await resolveHeaderImageUrl(booking);
  const headerImageBytes = headerImageUrl ? await resolveHeaderImageBytes(headerImageUrl) : null;

  const pdfBytes = await buildVoucherPdf({
    pages: vouchers.map((v) => toPageInput(v, booking)),
    layout,
    headerImageBytes,
    loadFont: opts.loadFont,
  });

  const { url } = await storeFile(Buffer.from(pdfBytes), { subdir: "vouchers", fileName: `${bookingId}.pdf` });
  await voucherRepository.setPdfFileNameForBooking(bookingId, url);

  const template = org?.settings?.emailTemplates?.voucherDelivery;
  const recipient = opts.toEmail?.trim() || booking.customer.email;
  await sendMail(
    organizationId,
    {
      to: recipient,
      subject: template?.subject?.trim() || `Your ticket for ${booking.eventName}`,
      html: template?.body?.trim() || defaultVoucherEmailHtml(booking, vouchers.length),
      attachments: [{ filename: `${booking.eventName.replace(/[^\w.-]+/g, "_")}.pdf`, content: Buffer.from(pdfBytes), contentType: "application/pdf" }],
    },
    opts.transporter,
  );

  // Records where it actually went, which is the point of the audit field when an admin re-sent to another address.
  await voucherRepository.markEmailedForBooking(bookingId, recipient, booking.customer.name);
  return url;
}

/** Registered into checkout-service's AFTER_BOOKING_PAID_HOOKS below. issueVoucherRowsForBooking (row creation) already ran before hooks execute. */
export async function voucherPdfEmailAfterBookingPaidHook(booking: IBooking): Promise<void> {
  try {
    await issueVoucherPdfAndEmail(String(booking._id));
  } catch (error) {
    console.error("[tbook] voucher PDF/email failed", String(booking._id), error);
  }
}

AFTER_BOOKING_PAID_HOOKS.push(voucherPdfEmailAfterBookingPaidHook);
