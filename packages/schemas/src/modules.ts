import { z } from "zod";

/**
 * Feature modules (plugins) are code shipped with tBook; what is stored is
 * only where each one is switched on and its settings.
 *
 * - On an organization the entry is the entitlement, set by a system admin.
 *   Without it the module does not exist for that organization.
 * - On an event group or an event the entry narrows it inside the
 *   entitlement (set by org members with `module:manage`). An event
 *   inherits its group's entry when it has none of its own.
 *
 * `config` is module-specific and validated by the module itself.
 */
export const moduleStateSchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
  changedBy: z.string().nullable().optional(),
  changedAt: z.date().nullable().optional(),
});
export type ModuleState = z.infer<typeof moduleStateSchema>;

/** Keyed by module key, e.g. `{ "bus-transport": { enabled: true } }`. */
export const modulesMapSchema = z.record(z.string(), moduleStateSchema);
export type ModulesMap = z.infer<typeof modulesMapSchema>;

export const moduleScopes = ["org", "group", "event"] as const;
export type ModuleScope = (typeof moduleScopes)[number];
