import { bookingRepository, eventGroupRepository, eventRepository, organizationRepository, voucherRepository, type IBooking, type IVoucher } from "@tbook/db";
import { normalizeVoucherPdfLayout } from "@tbook/schemas";
import { withAllowedImages } from "./voucher-pdf-assets";
import { buildVoucherPdf, resolveVoucherImage, type VoucherPdfPageInput } from "./voucher-pdf";

/**
 * Renders the voucher PDF (using the org's fully-customizable layout, or
 * the shipped default) on demand. Nothing is stored: the PDF is fully
 * determined by the database (booking, vouchers, layout), so the email,
 * the guest download and a re-send all render it fresh — and a layout
 * edited later is picked up. At the door only the QR token matters.
 * Emailing it is booking-email.ts's job.
 *
 * Pictures (header, logo, background) are read from the organization's
 * uploads (voucher-pdf-assets.ts) or an https link, by resolveVoucherImage.
 */

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
    validDate: voucher.validDate ?? null,
  };
}

export interface RenderVoucherPdfOptions {
  /** Test seam — see buildVoucherPdf's loadFont param. Defaults to the vendored local font. */
  loadFont?: () => Promise<Uint8Array>;
}

export interface RenderedVoucherPdf {
  bytes: Uint8Array;
  voucherCount: number;
}

/**
 * Renders the voucher PDF for a booking's issued vouchers (one page each).
 * Returns null if the booking has no vouchers yet.
 */
export async function renderVoucherPdfForBooking(bookingId: string, opts: RenderVoucherPdfOptions = {}): Promise<RenderedVoucherPdf | null> {
  const [booking, vouchers] = await Promise.all([bookingRepository.findById(bookingId), voucherRepository.findByBookingId(bookingId)]);
  if (!booking || vouchers.length === 0) return null;

  const organizationId = booking.organizationId ? String(booking.organizationId) : null;
  const org = organizationId ? await organizationRepository.findById(organizationId) : null;
  const stored = org?.settings?.voucherPdfLayout ?? null;
  const layout = stored && organizationId ? withAllowedImages(organizationId, normalizeVoucherPdfLayout(stored)) : stored;

  const headerImageUrl = await resolveHeaderImageUrl(booking);
  const headerImageBytes = headerImageUrl ? await resolveVoucherImage(headerImageUrl, organizationId) : null;

  const bytes = await buildVoucherPdf({
    pages: vouchers.map((v) => toPageInput(v, booking)),
    layout,
    headerImageBytes,
    loadFont: opts.loadFont,
    // Uploaded pictures are only readable by the organization that owns them.
    loadImage: (url) => resolveVoucherImage(url, organizationId),
  });
  return { bytes, voucherCount: vouchers.length };
}

/** A sample voucher in the given (possibly unsaved) layout, so the editor can show what guests will get. */
export async function renderVoucherPdfPreview(organizationId: string, layout: unknown, opts: RenderVoucherPdfOptions = {}): Promise<Uint8Array> {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 14);
  return buildVoucherPdf({
    layout: withAllowedImages(organizationId, normalizeVoucherPdfLayout(layout)),
    loadFont: opts.loadFont,
    loadImage: (url) => resolveVoucherImage(url, organizationId),
    pages: [
      {
        token: "PREVIEW0SAMPLE0TOKEN0000000000",
        displayName: "Kovács Anna",
        attendeeFields: { email: "anna@example.com", phone: "+36 30 123 4567" },
        attendeeFieldSchema: [
          { key: "email", label: "Email", type: "email", required: true, helpText: "", sortOrder: 0 },
          { key: "phone", label: "Phone", type: "phone", required: false, helpText: "", sortOrder: 1 },
        ],
        eventName: "Sample Open Tournament",
        startDate: start,
        endDate: start,
        startTime: "10:00",
        endTime: "18:00",
        locationAddress: "1051 Budapest, Példa utca 1.",
        bookingId: "000000000000000000abcdef",
        validDate: start.toISOString().slice(0, 10),
      },
    ],
  });
}
