import { z } from "zod";
import { bookingStatuses, invoiceStatuses } from "./booking";
import { objectIdSchema } from "./common";
import { voucherStatuses } from "./voucher";
import { webhookEventTypeSchema } from "./organization";

/**
 * Request shapes for the v2 admin API. These live here, next to the entity
 * schemas, so the admin console's forms and filter controls validate
 * against the same definitions the route handlers do — the single-source-
 * of-truth rule this rebuild exists to enforce.
 */

/** Comma-separated query param (`?status=paid,confirmed`) → a filtered enum array. */
function csvEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((value) => value.trim())
        .filter((value): value is T[number] => (values as readonly string[]).includes(value)),
    )
    // An all-unknown list means "no usable filter", not "match nothing" —
    // returning undefined lets the repository omit the clause entirely
    // rather than building `{ $in: [] }`, which matches no rows at all.
    .transform((values_) => (values_.length > 0 ? values_ : undefined));
}

/** Coerces a query-string date, rejecting an unparseable one rather than silently dropping it. */
const queryDate = z.coerce.date();

export const adminBookingSortKeys = ["createdAt", "totalHuf", "eventName", "customerName"] as const;

export const adminBookingListQuerySchema = z.object({
  status: csvEnum(bookingStatuses).optional(),
  invoiceStatus: csvEnum(invoiceStatuses).optional(),
  eventId: objectIdSchema.optional(),
  groupId: objectIdSchema.optional(),
  hotelId: objectIdSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  createdFrom: queryDate.optional(),
  createdTo: queryDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.enum(adminBookingSortKeys).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
export type AdminBookingListQuery = z.infer<typeof adminBookingListQuerySchema>;

/** Export reuses the list filters but has no paging — it streams everything matched. */
export const adminBookingExportQuerySchema = adminBookingListQuerySchema.omit({
  page: true,
  pageSize: true,
  sortBy: true,
  sortDir: true,
});

export const adminBookingActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("confirm") }),
]);
export type AdminBookingAction = z.infer<typeof adminBookingActionSchema>;

export const adminResendEntriesSchema = z.object({
  /** Optional alternate recipient — the common support case is a typo'd address. */
  toEmail: z.string().trim().email().optional(),
});

export const adminCheckInRosterQuerySchema = z.object({
  status: csvEnum(voucherStatuses).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const adminVoucherScanSchema = z.object({
  /** The raw scanner payload — a bare token or the full QR URL; parsed downstream. */
  code: z.string().trim().min(1).max(500),
  eventId: objectIdSchema.optional(),
  mode: z.enum(["check_in", "lookup"]).default("check_in"),
});
export type AdminVoucherScan = z.infer<typeof adminVoucherScanSchema>;

export const adminSetActiveOrgSchema = z.object({
  organizationId: objectIdSchema,
});

/** Create/update an outbound webhook endpoint from the integrations screen. */
export const adminWebhookUpsertSchema = z.object({
  /** Absent means "create a new endpoint". */
  id: z.string().min(1).optional(),
  url: z.string().trim().url("Must be a valid URL"),
  description: z.string().trim().max(200).default(""),
  events: z.array(webhookEventTypeSchema).min(1, "Pick at least one event"),
  enabled: z.boolean().default(true),
});
export type AdminWebhookUpsert = z.infer<typeof adminWebhookUpsertSchema>;
