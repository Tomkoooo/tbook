import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

export const waitlistStatuses = ["waiting", "offered", "registered", "expired", "declined", "failed", "removed"] as const;
export type WaitlistStatus = (typeof waitlistStatuses)[number];

/** One person (or group) waiting for a place at a full event, with the registration they want. */
export interface IWaitlistEntry extends Document {
  organizationId: Types.ObjectId | null;
  eventId: Types.ObjectId;
  status: WaitlistStatus;
  guests: number;
  customer: { name: string; email: string; phone: string; note: string };
  /** The registration answers, checked when they joined and again when registered. */
  attendees: unknown[];
  returnBaseUrl: string | null;
  /** SHA-256 of the offer link token. */
  offerTokenHash: string | null;
  offeredAt: Date | null;
  offerExpiresAt: Date | null;
  /** Places held (event capacity) while an offer is open. */
  heldGuests: number;
  bookingId: Types.ObjectId | null;
  lastError: string;
  notifiedAt: Date | null;
  /** Test entry (v1 X-TBook-Test): its own queue, never mixed with live entries. */
  isTest: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WaitlistEntrySchema = new Schema<IWaitlistEntry>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", default: null, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true },
    status: { type: String, enum: waitlistStatuses, default: "waiting" },
    guests: { type: Number, required: true, min: 1 },
    customer: {
      name: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, default: "" },
      note: { type: String, default: "" },
    },
    attendees: { type: [Schema.Types.Mixed], default: [] },
    returnBaseUrl: { type: String, default: null },
    offerTokenHash: { type: String, default: null, index: true },
    offeredAt: { type: Date, default: null },
    offerExpiresAt: { type: Date, default: null },
    heldGuests: { type: Number, default: 0 },
    bookingId: { type: Schema.Types.ObjectId, ref: "TBookBooking", default: null },
    lastError: { type: String, default: "" },
    notifiedAt: { type: Date, default: null },
    isTest: { type: Boolean, default: false },
  },
  { timestamps: true },
);
WaitlistEntrySchema.index({ eventId: 1, status: 1, createdAt: 1 });

export const WaitlistEntryModel: Model<IWaitlistEntry> =
  mongoose.models.TBookWaitlistEntry ?? mongoose.model<IWaitlistEntry>("TBookWaitlistEntry", WaitlistEntrySchema, "tbookwaitlistentries");
