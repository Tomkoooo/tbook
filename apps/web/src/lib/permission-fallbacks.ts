import type { Permission } from "@tbook/schemas";

/**
 * Permissions added after most roles were saved, mapped to the existing
 * permission a role already has for the same kind of work (AGENTS.md:
 * roles saved before a permission existed don't have it).
 */
export const PERMISSION_FALLBACKS: Partial<Record<Permission, Permission[]>> = {
  "module:manage": ["event:write"],
  "list:manage": ["event:write"],
  "email:send": ["booking:manage"],
  "bus:manage": ["booking:manage"],
  "waitlist:manage": ["booking:manage"],
  "feedback:manage": ["event:write"],
};

/** The permission itself followed by its fallbacks. */
export function permissionWithFallbacks(permission: Permission): Permission[] {
  return [permission, ...(PERMISSION_FALLBACKS[permission] ?? [])];
}

export function hasPermissionOrFallback(permissions: Set<Permission> | Set<string>, permission: Permission): boolean {
  const set = permissions as Set<string>;
  return permissionWithFallbacks(permission).some((p) => set.has(p));
}
