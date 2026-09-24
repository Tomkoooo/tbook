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

export const tdartsSyncStatuses = ["pending", "synced", "waiting", "failed", "skipped"] as const;
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
  invoicePdfFileName: z.string().nullable().default(null),
  invoiceError: z.string().nullable().default(null),
  invoiceEmailSentAt: z.date().nullable().default(null),
  /** Storefront origin for the post-payment redirect (e.g. the WDF site). */
  checkoutReturnBaseUrl: z.string().nullable().default(null),
  expiresAt: z.date().nullable().default(null),
  tdartsSync: z.array(tdartsSyncEntrySchema).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Booking = z.infer<typeof bookingSchema>;
