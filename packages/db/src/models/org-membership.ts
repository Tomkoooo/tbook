import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import { membershipStatuses, type OrgMembership } from "@tbook/schemas";

/** Ported from the legacy plugin's models/TBookOrgMembership.ts. */
export interface IOrgMembership
  extends Document,
    Omit<OrgMembership, "id" | "organizationId" | "userId" | "roleIds"> {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  roleIds: Types.ObjectId[];
}

const OrgMembershipSchema = new Schema<IOrgMembership>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    roleIds: { type: [Schema.Types.ObjectId], ref: "TBookOrgRole", default: [] },
    status: { type: String, enum: membershipStatuses, default: "active", index: true },
  },
  { timestamps: true },
);

OrgMembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

export const OrgMembershipModel: Model<IOrgMembership> =
  mongoose.models.TBookOrgMembership ??
  mongoose.model<IOrgMembership>("TBookOrgMembership", OrgMembershipSchema, "tbookorgmemberships");
