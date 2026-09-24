import { z } from "zod";
import { objectIdSchema } from "./common";

/** Ported from the legacy plugin's models/TBookOrgMembership.ts. */
export const membershipStatuses = ["active", "invited", "disabled"] as const;
export const membershipStatusSchema = z.enum(membershipStatuses);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const orgMembershipSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema,
  userId: objectIdSchema,
  roleIds: z.array(objectIdSchema).default([]),
  status: membershipStatusSchema.default("active"),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type OrgMembership = z.infer<typeof orgMembershipSchema>;
