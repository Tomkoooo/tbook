import { z } from "zod";
import { objectIdSchema } from "./common";
import { attendeeFieldValueSchema } from "./value-objects";

/** Ported from the legacy plugin's models/TBookVoucher.ts. */

export const voucherStatuses = ["active", "checked_in", "void"] as const;
export const voucherStatusSchema = z.enum(voucherStatuses);
export type VoucherStatus = z.infer<typeof voucherStatusSchema>;

export const voucherEventSnapshotSchema = z.object({
  name: z.string(),
  startDate: z.date(),
  endDate: z.date(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  locationAddress: z.string().default(""),
});

export const voucherSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema.nullable().default(null),
  eventId: objectIdSchema,
  bookingId: objectIdSchema,
  /** 0-based guest index within the booking. */
  attendeeIndex: z.number().min(0),
  /** The attendee's stable id and registration number, copied when the voucher is issued. */
  attendeeId: z.string().nullable().default(null),
  registrationNumber: z.string().nullable().default(null),
  /** Copy of the guest's tags (e.g. "VIP") so check-in can show and filter them. */
  tags: z.array(z.string()).default([]),
  /** `yyyy-mm-dd` the pass is valid on (day-pass events); null = valid for the whole event. */
  validDate: z.string().nullable().default(null),
  /** Opaque QR token — unique, no PII. */
  token: z.string().min(1),
  status: voucherStatusSchema.default("active"),
  displayName: z.string().min(1),
  attendeeFields: z.record(z.string(), attendeeFieldValueSchema).default({}),
  eventSnapshot: voucherEventSnapshotSchema,
  /** Shared multi-page PDF filename for the whole booking. */
  pdfFileName: z.string().nullable().default(null),
  emailedAt: z.date().nullable().default(null),
  lastSentToEmail: z.string().nullable().default(null),
  lastSentToName: z.string().nullable().default(null),
  checkedInAt: z.date().nullable().default(null),
  checkedInByUserId: z.string().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Voucher = z.infer<typeof voucherSchema>;
