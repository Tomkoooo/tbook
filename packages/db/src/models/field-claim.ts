import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

/**
 * One claimed value of a `unique` registration field (e.g. an employee ID)
 * within an event. The unique index is what makes two registrations racing
 * for the same value impossible; the claim is deleted when the booking is
 * cancelled or expires, freeing the value again.
 */
export interface IFieldClaim extends Document {
  organizationId: Types.ObjectId | null;
  eventId: Types.ObjectId;
  fieldKey: string;
  /** Normalised value (see @tbook/domain normalizeUniqueValue). */
  value: string;
  bookingId: Types.ObjectId;
  createdAt: Date;
}

const FieldClaimSchema = new Schema<IFieldClaim>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", default: null },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true },
    fieldKey: { type: String, required: true },
    value: { type: String, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "TBookBooking", required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

FieldClaimSchema.index({ eventId: 1, fieldKey: 1, value: 1 }, { unique: true });

export const FieldClaimModel: Model<IFieldClaim> =
  mongoose.models.TBookFieldClaim ?? mongoose.model<IFieldClaim>("TBookFieldClaim", FieldClaimSchema, "tbookfieldclaims");
