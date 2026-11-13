import { z } from "zod";
import { objectIdSchema } from "./common";
import { attendeeFieldDefSchema, bookingAttendeeSchema } from "./value-objects";

/** Ported from the legacy plugin's models/TBookBooking.ts. */

export const bookingStatuses = ["pending", "checkout_started", "paid", "confirmed", "cancelled", "expired"] as const;
export const bookingStatusSchema = z.enum(bookingStatuses);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/** Enforced in @tbook/services (booking-service): only these transitions are valid. */
export const VALID_BOOKING_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["checkout_started", "cancelled", "expired"],
  checkout_started: ["paid", "cancelled", "expired"],
  paid: ["confirmed", "cancelled"],
  confirmed: ["cancelled"],
  cancelled: [],
  expired: [],
};

export const invoiceStatuses = ["none", "pending", "issued", "failed", "reversed"] as const;
export const invoiceStatusSchema = z.enum(invoiceStatuses);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const billingTypes = ["personal", "company", "sport"] as const;
export const billingTypeSchema = z.enum(billingTypes);

export const tdartsSyncStatuses = ["pending", "synced", "waiting", "failed", "skipped", "withdrawn"] as const;
export const tdartsSyncStatusSchema = z.enum(tdartsSyncStatuses);

export const customerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  note: z.string().default(""),
});
export type Customer = z.infer<typeof customerSchema>;

export const billingInfoSchema = z.object({
  billingType: billingTypeSchema.default("personal"),
  name: z.string().min(1),
  zip: z.string().min(1),
  city: z.string().min(1),
  street: z.string().min(1),
  countryCode: z.string().default("HU"),
  taxNumber: z.string().default(""),
});
export type BillingInfo = z.infer<typeof billingInfoSchema>;

export const priceLineSchema = z.object({
  key: z.string(),
  label: z.string(),
  amountHuf: z.number(),
});

export const priceQuoteSchema = z.object({
  guests: z.number(),
  accommodationGuests: z.number().optional(),
  nights: z.number().default(0),
  ticketSubtotalHuf: z.number(),
  accommodationBaseHuf: z.number().default(0),
  accommodationOptionsHuf: z.number().default(0),
  accommodationSubtotalHuf: z.number().default(0),
  totalHuf: z.number(),
  lines: z.array(priceLineSchema).default([]),
});
export type PriceQuote = z.infer<typeof priceQuoteSchema>;

export const tdartsSyncEntrySchema = z.object({
  participantKey: z.string(),
  status: tdartsSyncStatusSchema.default("pending"),
  tournamentCode: z.string(),
  playerId: z.string().nullable().default(null),
  rosterStatus: z.enum(["applied", "waiting"]).nullable().default(null),
  error: z.string().nullable().default(null),
  syncedAt: z.date().nullable().default(null),
});

export const selectionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.number()),
]);
export const selectionsSchema = z.record(z.string(), selectionValueSchema);
export type Selections = z.infer<typeof selectionsSchema>;

/**
 * How a booking was paid. The legacy system only ever had Stripe, so
 * "stripe" is the default and every existing document reads as that; the
 * rest exist for an org manager recording a payment taken outside the
 * platform (bank transfer, cash at the door, a card taken on a terminal, a
 * comped entry).
 */
export const paymentMethods = ["stripe", "transfer", "cash", "card", "comp", "other"] as const;
export const paymentMethodSchema = z.enum(paymentMethods);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** Where a booking came from. Legacy documents have no value and read as "storefront". */
export const bookingSources = ["storefront", "admin", "pos"] as const;
export const bookingSourceSchema = z.enum(bookingSources);
export type BookingSource = z.infer<typeof bookingSourceSchema>;

/**
 * Record of a payment an org manager marked manually. Kept as its own
 * object rather than loose fields so "who marked this paid, when, and on
 * what evidence" stays answerable — the audit question an org manager
 * actually gets asked.
 */
export const offlinePaymentSchema = z.object({
  method: paymentMethodSchema.default("transfer"),
  /** Bank transfer reference, receipt number, "cash at door", etc. */
  reference: z.string().default(""),
  note: z.string().default(""),
  markedByUserId: objectIdSchema.nullable().default(null),
  markedAt: z.date().nullable().default(null),
});
export type OfflinePayment = z.infer<typeof offlinePaymentSchema>;

/** Whether an invoice came from Számlázz.hu or was recorded by hand. */
export const invoiceSources = ["szamlazz", "manual"] as const;
export const invoiceSourceSchema = z.enum(invoiceSources);
export type InvoiceSource = z.infer<typeof invoiceSourceSchema>;

/**
 * A card payment collected through a SumUp Solo reader. Kept on the booking
 * so a webhook (or a poll) arriving later can find which sale it settles,
 * and so a failed or abandoned attempt leaves a record of why.
 */
export const cardCheckoutStatuses = ["waiting", "successful", "failed", "cancelled"] as const;
export const cardCheckoutSchema = z.object({
  provider: z.literal("sumup").default("sumup"),
  readerId: z.string(),
  readerName: z.string().default(""),
  /** SumUp's id for the in-flight transaction; the webhook and status lookups key on it. */
  clientTransactionId: z.string(),
  /** Random path segment of the webhook URL we gave SumUp for this one checkout. */
  webhookToken: z.string(),
  status: z.enum(cardCheckoutStatuses).default("waiting"),
  failureReason: z.string().nullable().default(null),
  /** SumUp's transaction code once paid — the number printed on the customer's receipt. */
  transactionCode: z.string().nullable().default(null),
  startedAt: z.date(),
  settledAt: z.date().nullable().default(null),
});
export type CardCheckout = z.infer<typeof cardCheckoutSchema>;

/**
 * How the customer receives their documents. "email" (every legacy and
 * online booking): one email with ticket + invoice. "receipt": a walk-in
 * counter sale — nothing is emailed; a Számlázz.hu receipt (nyugta) is
 * issued and printed at the counter instead, and the entries are checked
 * in on the spot.
 */
export const bookingDeliveries = ["email", "receipt"] as const;
export const bookingDeliverySchema = z.enum(bookingDeliveries);
export type BookingDelivery = z.infer<typeof bookingDeliverySchema>;

/** Placeholder contact for walk-in sales; `.invalid` is a reserved domain that can never receive mail. */
export const WALK_IN_CUSTOMER_EMAIL = "walk-in@pos.invalid";

export const receiptStatuses = ["none", "pending", "issued", "failed"] as const;
export const receiptStatusSchema = z.enum(receiptStatuses);
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;

export const bookingReceiptSchema = z.object({
  status: receiptStatusSchema.default("none"),
  /** Számlázz.hu receipt number, e.g. NYGTA-2026-123. */
  number: z.string().nullable().default(null),
  pdfFileName: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  issuedAt: z.date().nullable().default(null),
});
export type BookingReceipt = z.infer<typeof bookingReceiptSchema>;

export const cancelledAttendeeSchema = z.object({
  attendee: bookingAttendeeSchema,
  cancelledAt: z.date(),
  /** "guest", "admin:<userId>", "system". */
  cancelledBy: z.string(),
  reason: z.string().default(""),
});
export type CancelledAttendee = z.infer<typeof cancelledAttendeeSchema>;

export const bookingChangeSchema = z.object({
  at: z.date(),
  by: z.string(),
  action: z.enum(["edited", "attendee_cancelled", "booking_cancelled"]),
  attendeeId: z.string().nullable().default(null),
  registrationNumber: z.string().nullable().default(null),
  changes: z.array(z.object({ field: z.string(), before: z.string(), after: z.string() })).default([]),
});
export type BookingChange = z.infer<typeof bookingChangeSchema>;

export const bookingSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema.nullable().default(null),
  groupId: objectIdSchema.nullable().default(null),
  eventId: objectIdSchema,
  hotelId: objectIdSchema.nullable().default(null),
  // Denormalized for fast admin tables + stable history after the event/hotel are edited later.
  eventName: z.string(),
  groupName: z.string().default(""),
  hotelName: z.string().default(""),
  customer: customerSchema,
  billing: billingInfoSchema.nullable().default(null),
  // Snapshot of the event's attendee field schema at booking time.
  attendeeFieldSchema: z.array(attendeeFieldDefSchema).default([]),
  teamMemberFieldSchema: z.array(attendeeFieldDefSchema).default([]),
  teamMemberLimit: z.number().nullable().default(null),
  playersPerTicket: z.number().min(1).default(1),
  attendees: z.array(bookingAttendeeSchema).default([]),
  guests: z.number().min(1),
  nights: z.number().min(0).default(0),
  selections: selectionsSchema.default({}),
  /** The day-pass discount code applied at checkout, if any (its `code`, not its label). */
  discountCode: z.string().nullable().default(null),
  quote: priceQuoteSchema,
  totalHuf: z.number().min(0),
  currency: z.string().default("HUF"),
  status: bookingStatusSchema.default("pending"),
  stripeSessionId: z.string().nullable().default(null),
  stripePaymentIntentId: z.string().nullable().default(null),
  /** Links sibling bookings created in one multi-event checkout. */
  checkoutBundleId: z.string().nullable().default(null),
  paidAt: z.date().nullable().default(null),
  invoiceStatus: invoiceStatusSchema.default("none"),
  invoiceId: z.string().nullable().default(null),
  /** Legacy: a PDF file on disk. New invoices aren't stored — Számlázz.hu ones are fetched on demand. */
  invoicePdfFileName: z.string().nullable().default(null),
  /** A manually attached invoice PDF (not from Számlázz.hu), in the blob store. */
  invoicePdfBlobId: z.string().nullable().default(null),
  invoiceError: z.string().nullable().default(null),
  invoiceEmailSentAt: z.date().nullable().default(null),
  /** Storefront origin for the post-payment redirect (e.g. the WDF site). */
  checkoutReturnBaseUrl: z.string().nullable().default(null),
  expiresAt: z.date().nullable().default(null),
  tdartsSync: z.array(tdartsSyncEntrySchema).default([]),
  /** "storefront" for every legacy document; "admin" for a manually created registration. */
  source: bookingSourceSchema.default("storefront"),
  createdByUserId: objectIdSchema.nullable().default(null),
  /** How it was paid. Legacy documents default to "stripe", which is what they were. */
  paymentMethod: paymentMethodSchema.default("stripe"),
  /** Present only when an org manager recorded the payment by hand. */
  offlinePayment: offlinePaymentSchema.nullable().default(null),
  /** Distinguishes a Számlázz.hu invoice from an invoice number typed in by an admin. */
  invoiceSource: invoiceSourceSchema.default("szamlazz"),
  /** Human-readable invoice number when recorded manually (invoiceId stays the provider's id). */
  invoiceNumber: z.string().nullable().default(null),
  /** Present when a seller charged the card on a SumUp reader from the point of sale. */
  cardCheckout: cardCheckoutSchema.nullable().default(null),
  delivery: bookingDeliverySchema.default("email"),
  /** Present only for walk-in ("receipt") sales. */
  receipt: bookingReceiptSchema.nullable().default(null),
  /** Free-form admin note, separate from the guest's own checkout note. */
  adminNote: z.string().default(""),
  /** Booking-level registration number (the group leader's code); attendees carry their own. */
  registrationNumber: z.string().nullable().default(null),
  /** Guests removed from a group registration — kept, listed as cancelled. */
  cancelledAttendees: z.array(cancelledAttendeeSchema).default([]),
  /** Edits and per-guest cancellations, newest last. */
  changeLog: z.array(bookingChangeSchema).default([]),
  /**
   * A test booking made through the v1 API with the preview key plus
   * `X-TBook-Test: 1`: really saved and emailed ("[TESZT] " subjects), but
   * apart from live data — no capacity, no bus seats, own ID namespace,
   * left out of statistics, exports and check-in. Removed with
   * `tbook-cli booking purge-test`.
   */
  isTest: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Booking = z.infer<typeof bookingSchema>;
