import { z } from "zod";
import { objectIdSchema } from "./common";

/**
 * A short-lived "pending login" record used to let one browser (the one
 * that approves/confirms) hand a session to a different browser (the one
 * that's waiting/polling) — QR-code sign-in, and choosing to finish a
 * magic-link sign-in on the device that originally requested it rather
 * than the device the email was opened on.
 */
export const loginRequestPurposeSchema = z.enum(["qr", "email-switch"]);
export type LoginRequestPurpose = z.infer<typeof loginRequestPurposeSchema>;

export const loginRequestStatusSchema = z.enum(["pending", "confirmed", "completed", "denied", "expired"]);
export type LoginRequestStatus = z.infer<typeof loginRequestStatusSchema>;

export const loginRequestSchema = z.object({
  id: objectIdSchema,
  token: z.string().min(1),
  purpose: loginRequestPurposeSchema,
  status: loginRequestStatusSchema,
  requesterLabel: z.string().min(1),
  callbackUrl: z.string().min(1),
  confirmedUserId: objectIdSchema.nullable().default(null),
  confirmedEmail: z.string().email().nullable().default(null),
  confirmedName: z.string().nullable().default(null),
  confirmedImage: z.string().nullable().default(null),
  expiresAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;
