import { z } from "zod";
import { objectIdSchema } from "./common";

/**
 * Ported from the legacy plugin's models/TBookOrgInvite.ts. Note: the
 * legacy org-service silently auto-joined an invited email that already had
 * a User account (skipping this record entirely) — packages/services fixes
 * that inconsistency to always create a real invite + accept step; this
 * schema is unchanged since the fix is behavioral, not shape-related.
 */
export const orgInviteSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema,
  email: z.string().email(),
  roleIds: z.array(objectIdSchema).default([]),
  tokenHash: z.string().min(1),
  expiresAt: z.date(),
  invitedBy: objectIdSchema.nullable().default(null),
  acceptedAt: z.date().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type OrgInvite = z.infer<typeof orgInviteSchema>;
