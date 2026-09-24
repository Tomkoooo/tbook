import type { OptionDef } from "@tbook/schemas";

/** Ported from the legacy plugin's lib/option-merge.ts. */

/** Group-level defaults first; event/hotel options override on duplicate keys. */
export function mergeOptionSchemas(groupOptions: OptionDef[] = [], localOptions: OptionDef[] = []): OptionDef[] {
  const byKey = new Map<string, OptionDef>();
  for (const option of groupOptions) byKey.set(option.key, option);
  for (const option of localOptions) byKey.set(option.key, option);
  return [...byKey.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
