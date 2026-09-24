import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import { organizationStatuses, type Organization } from "@tbook/schemas";

/**
 * Ported from the legacy plugin's models/TBookOrganization.ts. Document type
 * is derived from the @tbook/schemas Organization type (single source of
 * truth for the field set) with id-like fields re-typed to Types.ObjectId —
 * the fix for the legacy system's independently hand-synced Zod/Mongoose
 * shapes. `xxxEnc` fields hold AES-encrypted secrets; the encrypt/decrypt
 * helper is added when packages/services/org-service is ported (TODO).
 */
export interface IOrganization
  extends Document,
    Omit<Organization, "id" | "createdBy"> {
  createdBy: Types.ObjectId | null;
}

const StripeSettingsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    secretKeyEnc: { type: String, default: "" },
    webhookSecretEnc: { type: String, default: "" },
    publishableKey: { type: String, default: "" },
  },
  { _id: false },
);

const SmtpSettingsSchema = new Schema(
  {
    host: { type: String, default: "" },
    port: { type: Number, default: 587 },
    user: { type: String, default: "" },
    passEnc: { type: String, default: "" },
    fromEmail: { type: String, default: "" },
    fromName: { type: String, default: "" },
  },
  { _id: false },
);

const SzamlazzSettingsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    agentKeyEnc: { type: String, default: "" },
    sellerName: { type: String, default: "" },
    sellerBank: { type: String, default: "" },
    sellerBankAccount: { type: String, default: "" },
    vatPercent: { type: Number, default: 27 },
  },
  { _id: false },
);

const TDartsSettingsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    apiBaseUrl: { type: String, default: "" },
    embedClientId: { type: String, default: "" },
    partnerClientId: { type: String, default: "" },
    partnerClientSecretEnc: { type: String, default: "" },
  },
  { _id: false },
);

const EmailTemplateOverrideSchema = new Schema(
  {
    subject: { type: String, default: "" },
    body: { type: String, default: "" },
  },
  { _id: false },
);

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: organizationStatuses, default: "active", index: true },
    settings: {
      currency: { type: String, default: "HUF" },
      stripe: { type: StripeSettingsSchema, default: undefined },
      smtp: { type: SmtpSettingsSchema, default: undefined },
      szamlazz: { type: SzamlazzSettingsSchema, default: undefined },
      emailTemplates: {
        bookingConfirmation: { type: EmailTemplateOverrideSchema, default: undefined },
        voucherDelivery: { type: EmailTemplateOverrideSchema, default: undefined },
        invoiceSent: { type: EmailTemplateOverrideSchema, default: undefined },
      },
      voucherPdfLayout: { type: Schema.Types.Mixed, default: undefined },
      tdarts: { type: TDartsSettingsSchema, default: undefined },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export const OrganizationModel: Model<IOrganization> =
  mongoose.models.TBookOrganization ??
  mongoose.model<IOrganization>("TBookOrganization", OrganizationSchema, "tbookorganizations");
