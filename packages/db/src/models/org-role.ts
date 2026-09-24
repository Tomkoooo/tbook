import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import { TBOOK_PERMISSIONS, type OrgRole } from "@tbook/schemas";

/** Ported from the legacy plugin's models/TBookOrgRole.ts. */
export interface IOrgRole extends Document, Omit<OrgRole, "id" | "organizationId"> {
  organizationId: Types.ObjectId;
}

const OrgRoleSchema = new Schema<IOrgRole>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    permissions: { type: [String], enum: TBOOK_PERMISSIONS, default: [] },
    isBuiltIn: { type: Boolean, default: false },
  },
  { timestamps: true },
);

OrgRoleSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const OrgRoleModel: Model<IOrgRole> =
  mongoose.models.TBookOrgRole ?? mongoose.model<IOrgRole>("TBookOrgRole", OrgRoleSchema, "tbookorgroles");
