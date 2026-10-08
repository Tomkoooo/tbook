import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import {
  billingTypes,
  bookingSources,
  bookingStatuses,
  invoiceSources,
  invoiceStatuses,
  paymentMethods,
  tdartsSyncStatuses,
  type Booking,
} from "@tbook/schemas";
import { attendeeFieldDefSchema, bookingAttendeeSchema } from "./value-object-schemas";

/** Ported from the legacy plugin's models/TBookBooking.ts. */
export interface IBooking
  extends Document,
    Omit<Booking, "id" | "organizationId" | "groupId" | "eventId" | "hotelId"> {
  organizationId: Types.ObjectId | null;
  groupId: Types.ObjectId | null;
  eventId: Types.ObjectId;
  hotelId: Types.ObjectId | null;
}

const CustomerSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const BillingSchema = new Schema(
  {
    billingType: { type: String, enum: billingTypes, default: "personal" },
    name: { type: String, required: true },
    zip: { type: String, required: true },
    city: { type: String, required: true },
    street: { type: String, required: true },
    countryCode: { type: String, default: "HU" },
    taxNumber: { type: String, default: "" },
  },
  { _id: false },
);

const QuoteSchema = new Schema(
  {
    guests: { type: Number, required: true },
    nights: { type: Number, default: 0 },
    ticketSubtotalHuf: { type: Number, required: true },
    accommodationBaseHuf: { type: Number, default: 0 },
    accommodationOptionsHuf: { type: Number, default: 0 },
    accommodationSubtotalHuf: { type: Number, default: 0 },
    totalHuf: { type: Number, required: true },
    lines: { type: [{ key: String, label: String, amountHuf: Number }], default: [] },
  },
  { _id: false },
);

const TDartsSyncEntrySchema = new Schema(
  {
    participantKey: { type: String, required: true },
    status: { type: String, enum: tdartsSyncStatuses, default: "pending" },
    tournamentCode: { type: String, required: true },
    playerId: { type: String, default: null },
    rosterStatus: { type: String, enum: ["applied", "waiting", null], default: null },
    error: { type: String, default: null },
    syncedAt: { type: Date, default: null },
  },
  { _id: false },
);

/**
 * Payment an org manager recorded by hand. Its own subdocument so "who
 * marked this paid, when, on what evidence" stays answerable.
 */
const OfflinePaymentSchema = new Schema(
  {
    method: { type: String, enum: paymentMethods, default: "transfer" },
    reference: { type: String, default: "" },
    note: { type: String, default: "" },
    markedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    markedAt: { type: Date, default: null },
  },
  { _id: false },
);

const BookingSchema = new Schema<IBooking>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", default: null, index: true },
    groupId: { type: Schema.Types.ObjectId, ref: "TBookEventGroup", default: null, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true, index: true },
    hotelId: { type: Schema.Types.ObjectId, ref: "TBookHotel", default: null, index: true },
    // Denormalized for fast admin tables + stable history after the event/hotel are edited later.
    eventName: { type: String, required: true },
    groupName: { type: String, default: "" },
    hotelName: { type: String, default: "" },
    customer: { type: CustomerSchema, required: true },
    billing: { type: BillingSchema, default: null },
    attendeeFieldSchema: { type: [attendeeFieldDefSchema], default: [] },
    teamMemberFieldSchema: { type: [attendeeFieldDefSchema], default: [] },
    teamMemberLimit: { type: Number, default: null },
    playersPerTicket: { type: Number, default: 1, min: 1 },
    attendees: { type: [bookingAttendeeSchema], default: [] },
    guests: { type: Number, required: true, min: 1 },
    nights: { type: Number, default: 0, min: 0 },
    selections: { type: Schema.Types.Mixed, default: {} },
    quote: { type: QuoteSchema, required: true },
    totalHuf: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "HUF" },
    status: { type: String, enum: bookingStatuses, default: "pending", index: true },
    stripeSessionId: { type: String, default: null, index: true },
    stripePaymentIntentId: { type: String, default: null },
    checkoutBundleId: { type: String, default: null, index: true },
    paidAt: { type: Date, default: null },
    invoiceStatus: { type: String, enum: invoiceStatuses, default: "none" },
    invoiceId: { type: String, default: null },
    invoicePdfFileName: { type: String, default: null },
    invoiceError: { type: String, default: null },
    invoiceEmailSentAt: { type: Date, default: null },
    checkoutReturnBaseUrl: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    tdartsSync: { type: [TDartsSyncEntrySchema], default: [] },
    // Every legacy document lacks these; the defaults are chosen so an
    // existing booking reads exactly as what it actually was (a Stripe-paid
    // storefront booking with a Számlázz.hu invoice).
    source: { type: String, enum: bookingSources, default: "storefront", index: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    paymentMethod: { type: String, enum: paymentMethods, default: "stripe" },
    offlinePayment: { type: OfflinePaymentSchema, default: null },
    invoiceSource: { type: String, enum: invoiceSources, default: "szamlazz" },
    invoiceNumber: { type: String, default: null },
    adminNote: { type: String, default: "" },
  },
  { timestamps: true },
);

BookingSchema.index({ createdAt: -1 });
BookingSchema.index({ "customer.email": 1 });

export const BookingModel: Model<IBooking> =
  mongoose.models.TBookBooking ?? mongoose.model<IBooking>("TBookBooking", BookingSchema, "tbookbookings");
