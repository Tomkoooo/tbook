import { z } from "zod";
import { objectIdSchema } from "./common";
import { permissionSchema } from "./permissions";

/** Ported from the legacy plugin's models/TBookOrgRole.ts. */
export const orgRoleSchema = z.object({
  id: objectIdSchema,
  organizationId: objectIdSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  permissions: z.array(permissionSchema).default([]),
  isBuiltIn: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type OrgRole = z.infer<typeof orgRoleSchema>;
