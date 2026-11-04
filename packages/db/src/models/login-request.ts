import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import type { LoginRequest } from "@tbook/schemas";

export interface ILoginRequest extends Document, Omit<LoginRequest, "id" | "confirmedUserId"> {
  confirmedUserId: Types.ObjectId | null;
}

const LoginRequestSchema = new Schema<ILoginRequest>(
  {
    token: { type: String, required: true, unique: true, index: true },
    purpose: { type: String, enum: ["qr", "email-switch"], required: true },
    status: {
      type: String,
      enum: ["pending", "confirmed", "completed", "denied", "expired"],
      default: "pending",
      required: true,
    },
    requesterLabel: { type: String, required: true },
    callbackUrl: { type: String, required: true },
    confirmedUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    confirmedEmail: { type: String, default: null },
    confirmedName: { type: String, default: null },
    confirmedImage: { type: String, default: null },
    // TTL index: Mongo deletes the document once expiresAt passes, so
    // pending/stale cross-device logins clean themselves up.
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

export const LoginRequestModel: Model<ILoginRequest> =
  mongoose.models.TBookLoginRequest ??
  mongoose.model<ILoginRequest>("TBookLoginRequest", LoginRequestSchema, "tbookloginrequests");
