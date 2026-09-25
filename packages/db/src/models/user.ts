import mongoose, { Schema, type Document, type Model } from "mongoose";
import { userRoleSchema, type User } from "@tbook/schemas";

/**
 * Ported (leaner) from the legacy webshop-engine's core models/User.ts.
 * `collection: "users"` is required to match @auth/mongodb-adapter's
 * default collection name — this is also the exact collection any existing
 * accounts already live in, which is how a returning admin's email-based
 * magic-link sign-in lands on the same document (and keeps its
 * isSystemAdmin flag).
 */
export interface IUser extends Document, Omit<User, "id"> {}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, default: null },
    email: { type: String, required: true, unique: true },
    image: { type: String, default: null },
    emailVerified: { type: Date, default: null },
    role: { type: String, enum: userRoleSchema.options, default: "USER" },
    isSystemAdmin: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: "users" },
);

export const UserModel: Model<IUser> = mongoose.models.User ?? mongoose.model<IUser>("User", UserSchema);
