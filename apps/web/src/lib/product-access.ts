import type { Permission } from "@tbook/schemas";

/**
 * Products arrived after most roles were saved, so roles that predate
 * product:read/product:write fall back to the matching event permission —
 * the same approach as sale:create → booking:manage.
 */
export function canReadProducts(permissions: Set<Permission> | Set<string>): boolean {
  const p = permissions as Set<string>;
  return p.has("product:read") || p.has("product:write") || p.has("event:read");
}

export function canWriteProducts(permissions: Set<Permission> | Set<string>): boolean {
  const p = permissions as Set<string>;
  return p.has("product:write") || p.has("event:write");
}
