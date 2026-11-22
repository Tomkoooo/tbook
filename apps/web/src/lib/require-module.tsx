import "@/lib/register-modules";
import type { ReactElement } from "react";
import { PlugZap } from "lucide-react";
import { notFound } from "next/navigation";
import { eventRepository, type IEvent } from "@tbook/db";
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

/**
 * The event of an event-scoped route (`/admin/events/[eventId]/…`), checked
 * against the caller's organization — another tenant's id is a 404, never data.
 * Every page under events/[eventId] starts with this.
 */
export async function requireEvent(organizationId: string, eventId: string): Promise<IEvent> {
  const event = /^[0-9a-f]{24}$/i.test(eventId) ? await eventRepository.findById(eventId) : null;
  if (!event || String(event.organizationId) !== organizationId) notFound();
  return event;
}

/**
 * Per-event module guard for event tools: the module must be on for THIS event
 * (org entitlement → group → event), not only for the organization.
 *
 *   const event = await requireEvent(organizationId, eventId);
 *   const off = await requireEventModule(organizationId, event, BUS_TRANSPORT, "Bus transfers");
 *   if (off) return off;
 */
export async function requireEventModule(organizationId: string, event: IEvent, moduleKey: string, title?: string): Promise<ReactElement | null> {
  const modules = await resolveModules({ organizationId, event });
  if (modules.isOn(moduleKey)) return null;
  const name = title ?? getModuleDefinition(moduleKey)?.name ?? moduleKey;
  return (
    <>
      <PageTitle title={name} back={{ href: `/admin/events/${String(event._id)}`, label: event.name }} />
      <SectionCard>
        <EmptyState icon={<PlugZap />} title={`${name} is not switched on for this event`} hint="Switch it on in the event's Modules section, or ask a system administrator to grant it to your organization." />
      </SectionCard>
    </>
  );
}
