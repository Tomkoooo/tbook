import { z } from "zod";
import { currencySchema, objectIdSchema } from "./common";

/**
 * Ported from the legacy plugin's models/TBookOrganization.ts. `xxxEnc`
 * fields hold AES-encrypted secrets (see org-secrets.ts in the legacy
 * plugin) — the encrypt/decrypt helper itself is ported when
 * packages/services/org-service is built; this schema only fixes the
 * field shapes.
 */

export const organizationStatuses = ["active", "suspended"] as const;
export const organizationStatusSchema = z.enum(organizationStatuses);
export type OrganizationStatus = z.infer<typeof organizationStatusSchema>;

export const orgStripeSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  secretKeyEnc: z.string().default(""),
  webhookSecretEnc: z.string().default(""),
  publishableKey: z.string().default(""),
});

export const orgSmtpSettingsSchema = z.object({
  host: z.string().default(""),
  port: z.number().default(587),
  user: z.string().default(""),
  passEnc: z.string().default(""),
  fromEmail: z.string().default(""),
  fromName: z.string().default(""),
});

export const orgSzamlazzSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  agentKeyEnc: z.string().default(""),
  sellerName: z.string().default(""),
  sellerBank: z.string().default(""),
  sellerBankAccount: z.string().default(""),
  vatPercent: z.number().default(27),
});

export const orgTDartsSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  apiBaseUrl: z.string().default(""),
  embedClientId: z.string().default(""),
  partnerClientId: z.string().default(""),
  partnerClientSecretEnc: z.string().default(""),
});

export const orgEmailTemplateOverrideSchema = z.object({
  subject: z.string().default(""),
  body: z.string().default(""),
});

export const orgEmailTemplatesSchema = z.object({
  bookingConfirmation: orgEmailTemplateOverrideSchema.nullable().optional(),
  voucherDelivery: orgEmailTemplateOverrideSchema.nullable().optional(),
  invoiceSent: orgEmailTemplateOverrideSchema.nullable().optional(),
});

export const organizationSettingsSchema = z.object({
  currency: currencySchema.default("HUF"),
  stripe: orgStripeSettingsSchema.optional(),
  smtp: orgSmtpSettingsSchema.optional(),
  szamlazz: orgSzamlazzSettingsSchema.optional(),
  emailTemplates: orgEmailTemplatesSchema.optional(),
  // Free-form layout; the legacy layout editor was removed, only
  // DEFAULT_VOUCHER_PDF_LAYOUT is used today. Kept for read compatibility.
  voucherPdfLayout: z.unknown().optional(),
  tdarts: orgTDartsSettingsSchema.optional(),
});
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export const organizationSchema = z.object({
  id: objectIdSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  status: organizationStatusSchema.default("active"),
  settings: organizationSettingsSchema,
  createdBy: objectIdSchema.nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const createOrganizationInputSchema = organizationSchema.pick({ name: true, slug: true }).extend({
  settings: organizationSettingsSchema.partial().optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;
