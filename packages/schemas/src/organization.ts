import { z } from "zod";
import { currencySchema, objectIdSchema } from "./common";
import { voucherPdfLayoutSchema } from "./voucher-pdf-layout";

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

/**
 * SumUp card terminals, driven remotely by the Cloud API. Only SumUp Solo
 * readers support this; other terminals (Air, 3G, PIN+) can't be paired, so
 * a seller keeps recording those card payments by hand.
 */
export const orgSumUpReaderSchema = z.object({
  /** SumUp's reader id, returned when the reader is paired. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** "solo" or "virtual-solo" (the sandbox simulator). */
  model: z.string().default("solo"),
});
export type OrgSumUpReader = z.infer<typeof orgSumUpReaderSchema>;

export const orgSumUpSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** The merchant's short code, e.g. "MH4H92C7". */
  merchantCode: z.string().default(""),
  apiKeyEnc: z.string().default(""),
  /** Affiliate app id and key (required by SumUp on every reader checkout). */
  affiliateAppId: z.string().default(""),
  affiliateKeyEnc: z.string().default(""),
  readers: z.array(orgSumUpReaderSchema).default([]),
});
export type OrgSumUpSettings = z.infer<typeof orgSumUpSettingsSchema>;

export const orgEmailTemplateOverrideSchema = z.object({
  subject: z.string().default(""),
  body: z.string().default(""),
});

export const orgEmailTemplatesSchema = z.object({
  bookingConfirmation: orgEmailTemplateOverrideSchema.nullable().optional(),
  voucherDelivery: orgEmailTemplateOverrideSchema.nullable().optional(),
  invoiceSent: orgEmailTemplateOverrideSchema.nullable().optional(),
});

/**
 * Outbound webhooks — the generic extension point for wiring tBook to
 * anything (Zapier/Make/n8n, a CRM, a Slack relay, a custom service)
 * without a code change per integration. Deliberately per-organization:
 * each tenant owns its own endpoints and its own signing secret.
 */
export const webhookEventTypes = [
  "booking.paid",
  "booking.cancelled",
  /** Contact or attendee details were edited by an org manager. */
  "booking.updated",
  "voucher.checked_in",
] as const;
export const webhookEventTypeSchema = z.enum(webhookEventTypes);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

export const orgWebhookSchema = z.object({
  /** Stable id so an endpoint can be edited/removed without positional addressing. */
  id: z.string().min(1),
  url: z.string().url().refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Must be an http(s) URL"),
  description: z.string().default(""),
  events: z.array(webhookEventTypeSchema).min(1),
  enabled: z.boolean().default(true),
  /** Encrypted shared secret; deliveries are signed with it (HMAC-SHA256). */
  secretEnc: z.string().default(""),
  createdAt: z.date().nullable().default(null),
  /** Delivery bookkeeping, so an admin can see a broken endpoint without log access. */
  lastStatus: z.number().nullable().default(null),
  lastError: z.string().nullable().default(null),
  lastDeliveredAt: z.date().nullable().default(null),
});
export type OrgWebhook = z.infer<typeof orgWebhookSchema>;

export const organizationSettingsSchema = z.object({
  currency: currencySchema.default("HUF"),
  stripe: orgStripeSettingsSchema.optional(),
  smtp: orgSmtpSettingsSchema.optional(),
  szamlazz: orgSzamlazzSettingsSchema.optional(),
  emailTemplates: orgEmailTemplatesSchema.optional(),
  // null = "use DEFAULT_VOUCHER_PDF_LAYOUT". Admin-editable per-block layout
  // (voucher-pdf-layout.ts) — normalizeVoucherPdfLayout() is what actually
  // reads this at render time, tolerating legacy/malformed data.
  voucherPdfLayout: voucherPdfLayoutSchema.nullable().default(null),
  tdarts: orgTDartsSettingsSchema.optional(),
  sumup: orgSumUpSettingsSchema.optional(),
  /** Outbound webhook endpoints. Absent/empty means this org has none. */
  webhooks: z.array(orgWebhookSchema).default([]),
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
