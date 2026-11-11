import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

/** Tags waiting for a guest who hasn't registered yet: applied when an attendee's identifying answer matches `value`. */
export interface IGuestTagRule extends Document {
  organizationId: Types.ObjectId | null;
  eventId: Types.ObjectId;
  /** Normalised (normalizeUniqueValue) identifying answer, e.g. an employee ID. */
  value: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const GuestTagRuleSchema = new Schema<IGuestTagRule>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", default: null },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true },
    value: { type: String, required: true },
    tags: { type: [String], default: [] },
  },
  { timestamps: true },
);
GuestTagRuleSchema.index({ eventId: 1, value: 1 }, { unique: true });

export const GuestTagRuleModel: Model<IGuestTagRule> =
  mongoose.models.TBookGuestTagRule ?? mongoose.model<IGuestTagRule>("TBookGuestTagRule", GuestTagRuleSchema, "tbookguesttagrules");
