import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import { voucherStatuses, type Voucher } from "@tbook/schemas";

/** Ported from the legacy plugin's models/TBookVoucher.ts. */
export interface IVoucher extends Document, Omit<Voucher, "id" | "organizationId" | "eventId" | "bookingId"> {
  organizationId: Types.ObjectId | null;
  eventId: Types.ObjectId;
  bookingId: Types.ObjectId;
}

const EventSnapshotSchema = new Schema(
  {
    name: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
    locationAddress: { type: String, default: "" },
  },
  { _id: false },
);

const VoucherSchema = new Schema<IVoucher>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", default: null, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "TBookBooking", required: true, index: true },
    attendeeIndex: { type: Number, required: true, min: 0 },
    token: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: voucherStatuses, default: "active", index: true },
    displayName: { type: String, required: true },
    attendeeFields: { type: Schema.Types.Mixed, default: {} },
    eventSnapshot: { type: EventSnapshotSchema, required: true },
    pdfFileName: { type: String, default: null },
    emailedAt: { type: Date, default: null },
    lastSentToEmail: { type: String, default: null },
    lastSentToName: { type: String, default: null },
    checkedInAt: { type: Date, default: null },
    checkedInByUserId: { type: String, default: null },
  },
  { timestamps: true },
);

VoucherSchema.index({ bookingId: 1, attendeeIndex: 1 }, { unique: true });
VoucherSchema.index({ eventId: 1, status: 1 });

export const VoucherModel: Model<IVoucher> =
  mongoose.models.TBookVoucher ?? mongoose.model<IVoucher>("TBookVoucher", VoucherSchema, "tbookvouchers");
