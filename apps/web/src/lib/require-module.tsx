import "@/lib/register-modules";
import type { ReactElement } from "react";
import { PlugZap } from "lucide-react";
import { getModuleDefinition, resolveModules } from "@tbook/services";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";

/** The sentence shown when a page's module isn't granted to the organization. */
export function moduleOffHint(moduleName: string): string {
  return `${moduleName} isn't switched on for your organization. Ask a system administrator to grant it.`;
}

/**
 * Hard guard for module pages: a module that is off for the organization is
 * not reachable by URL either, even though the sidebar already hides it.
 *
 * Call it right after requireAdminPage and return the result when it is not
 * null:
 *
 *   const off = await requireModule(organizationId, HOTELS, "Hotels");
 *   if (off) return off;
 *
 * It returns an empty-state page instead of redirecting, so the member sees
 * why (and nothing loops when the dashboard is itself the entry point).
 * `title` defaults to the module's registered name.
 */
export async function requireModule(organizationId: string, moduleKey: string, title?: string): Promise<ReactElement | null> {
  const modules = await resolveModules({ organizationId });
  if (modules.isOn(moduleKey)) return null;
  const name = title ?? getModuleDefinition(moduleKey)?.name ?? moduleKey;
  return (
    <>
      <PageTitle title={name} back={{ href: "/admin", label: "Dashboard" }} />
      <SectionCard>
        <EmptyState icon={<PlugZap />} title={`${name} is not available`} hint={moduleOffHint(name)} />
      </SectionCard>
    </>
  );
}
