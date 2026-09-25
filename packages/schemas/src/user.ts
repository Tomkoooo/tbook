import { z } from "zod";
import { objectIdSchema } from "./common";

/**
 * Ported (leaner) from the legacy webshop-engine's core models/User.ts —
 * only the fields tbook actually reads. Auth.js's MongoDB adapter owns
 * writes to this collection (name/email/image/emailVerified are set on
 * magic-link sign-in); `role`/`isSystemAdmin` are tbook-specific fields
 * synced separately (bootstrap-admin, session callbacks). Dropped entirely:
 * passwordHash (email magic-link sign-in only, no password), newsletter
 * flags, billingInfo, shippingAddress — generic webshop-engine e-commerce
 * fields with no tbook relevance.
 */
export const userRoleSchema = z.enum(["ADMIN", "USER"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userSchema = z.object({
  id: objectIdSchema,
  name: z.string().nullable().default(null),
  email: z.string().email(),
  image: z.string().nullable().default(null),
  emailVerified: z.date().nullable().default(null),
  role: userRoleSchema.default("USER"),
  isSystemAdmin: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type User = z.infer<typeof userSchema>;
