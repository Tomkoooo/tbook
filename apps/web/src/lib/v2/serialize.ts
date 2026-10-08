import type { IBooking, IVoucher } from "@tbook/db";

/**
 * v2 DTOs. The admin API deliberately does not return raw Mongoose
 * documents: `_id`/ObjectId/Date leaking into the contract is what made the
 * legacy surface impossible to type on the client, and a booking document
 * carries fields no admin client needs (Stripe ids, the full attendee
 * field schema snapshot). Keeping the mapping explicit means adding a field
 * to a model never silently widens the API.
 */

function id(value: unknown): string | null {
  return value == null ? null : String(value);
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

export interface BookingListItemDto {
  id: string;
  createdAt: string | null;
  status: string;
  eventId: string | null;
  eventName: string;
  groupName: string;
  hotelName: string;
  customer: { name: string; email: string; phone: string };
  guests: number;
  nights: number;
  totalHuf: number;
  currency: string;
  paidAt: string | null;
  invoiceStatus: string;
  /** "admin" when an org manager created it by hand, "storefront" otherwise. */
  source: string;
  paymentMethod: string;
  invoiceSource: string;
  invoiceNumber: string | null;
}

/** The row shape the admin table renders — intentionally narrower than the detail DTO. */
export function toBookingListItem(booking: IBooking): BookingListItemDto {
  return {
    id: String(booking._id),
    createdAt: iso(booking.createdAt),
    status: booking.status,
    eventId: id(booking.eventId),
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
    paidAt: iso(booking.paidAt),
    invoiceStatus: booking.invoiceStatus ?? "none",
    // Defaults match the Mongoose defaults, so a legacy document reads as
    // the Stripe-paid storefront booking it actually was.
    source: booking.source ?? "storefront",
    paymentMethod: booking.paymentMethod ?? "stripe",
    invoiceSource: booking.invoiceSource ?? "szamlazz",
    invoiceNumber: booking.invoiceNumber ?? null,
  };
}

export interface VoucherDto {
  id: string;
  bookingId: string | null;
  eventId: string | null;
  attendeeIndex: number;
  status: string;
  displayName: string;
  checkedInAt: string | null;
  emailedAt: string | null;
  lastSentToEmail: string | null;
  hasPdf: boolean;
}

export function toVoucherDto(voucher: IVoucher): VoucherDto {
  return {
    id: String(voucher._id),
    bookingId: id(voucher.bookingId),
    eventId: id(voucher.eventId),
    attendeeIndex: voucher.attendeeIndex ?? 0,
    status: voucher.status,
    displayName: voucher.displayName ?? "",
    checkedInAt: iso(voucher.checkedInAt),
    emailedAt: iso(voucher.emailedAt),
    lastSentToEmail: voucher.lastSentToEmail ?? null,
    // The token itself is deliberately never returned: it is the bearer
    // credential that admits someone at the door, and the admin table has
    // no use for it. Only the PDF (already behind its own auth) carries it.
    hasPdf: Boolean(voucher.pdfFileName),
  };
}

export interface BookingDetailDto extends BookingListItemDto {
  groupId: string | null;
  hotelId: string | null;
  billing: Record<string, unknown> | null;
  attendees: unknown[];
  selections: Record<string, unknown>;
  quote: Record<string, unknown>;
  invoiceId: string | null;
  invoiceError: string | null;
  adminNote: string;
  /** Present only when a payment was recorded by hand. */
  offlinePayment: Record<string, unknown> | null;
  invoiceEmailSentAt: string | null;
  expiresAt: string | null;
  tdartsSync: unknown[];
  updatedAt: string | null;
}

export function toBookingDetail(booking: IBooking): BookingDetailDto {
  return {
    ...toBookingListItem(booking),
    groupId: id(booking.groupId),
    hotelId: id(booking.hotelId),
    billing: booking.billing ? (JSON.parse(JSON.stringify(booking.billing)) as Record<string, unknown>) : null,
    attendees: booking.attendees ? (JSON.parse(JSON.stringify(booking.attendees)) as unknown[]) : [],
    selections: (booking.selections ?? {}) as Record<string, unknown>,
    quote: booking.quote ? (JSON.parse(JSON.stringify(booking.quote)) as Record<string, unknown>) : {},
    invoiceId: booking.invoiceId ?? null,
    invoiceError: booking.invoiceError ?? null,
    adminNote: booking.adminNote ?? "",
    offlinePayment: booking.offlinePayment
      ? (JSON.parse(JSON.stringify(booking.offlinePayment)) as Record<string, unknown>)
      : null,
    invoiceEmailSentAt: iso(booking.invoiceEmailSentAt),
    expiresAt: iso(booking.expiresAt),
    tdartsSync: booking.tdartsSync ? (JSON.parse(JSON.stringify(booking.tdartsSync)) as unknown[]) : [],
    updatedAt: iso(booking.updatedAt),
  };
}
