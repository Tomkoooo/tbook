import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import type { OrgInvite } from "@tbook/schemas";

/** Ported from the legacy plugin's models/TBookOrgInvite.ts. */
export interface IOrgInvite
  extends Document,
    Omit<OrgInvite, "id" | "organizationId" | "roleIds" | "invitedBy"> {
  organizationId: Types.ObjectId;
  roleIds: Types.ObjectId[];
  invitedBy: Types.ObjectId | null;
}

const OrgInviteSchema = new Schema<IOrgInvite>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
    email: { type: String, required: true, index: true },
    roleIds: { type: [Schema.Types.ObjectId], ref: "TBookOrgRole", default: [] },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

OrgInviteSchema.index({ organizationId: 1, email: 1 });

export const OrgInviteModel: Model<IOrgInvite> =
  mongoose.models.TBookOrgInvite ??
  mongoose.model<IOrgInvite>("TBookOrgInvite", OrgInviteSchema, "tbookorginvites");
