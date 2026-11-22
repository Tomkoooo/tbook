"use server";

import { organizationRepository } from "@tbook/db";
import { listEventsForOrg, listGroupsForOrg, resolveMembershipPermissions, resolveModulesFromDocs } from "@tbook/services";
import { TBOOK_OWNER_PERMISSIONS } from "@tbook/schemas";
import { requireOrgContext, requireOrgPermission } from "@/lib/admin-auth";
import { EVENT_TOOLS, filterEventTools, type EventTool } from "@/lib/event-tools";

export interface ShellEntities {
  events: Array<{
    id: string;
    name: string;
    groupId: string | null;
    startDate: string;
    /** Keys of the tools that are on for this event and open to the member (for the palette's "Bus — Event name"). */
    tools: string[];
  }>;
  groups: Array<{ id: string; name: string }>;
}

const MAX_EVENTS = 300;

/** The tools worth a palette entry per event; the rest are one click away inside the event. */
const PALETTE_TOOLS: readonly EventTool[] = EVENT_TOOLS.filter((tool) => tool.key !== "preview" && tool.key !== "vip");

async function memberPermissions(organizationId: string): Promise<Set<string>> {
  const { userId, isSystemAdmin } = await requireOrgContext();
  if (isSystemAdmin) return new Set(TBOOK_OWNER_PERMISSIONS);
  return new Set((await resolveMembershipPermissions(organizationId, userId))?.permissions ?? []);
}

/**
 * Names of the organization's events and groups, for the command palette,
 * the breadcrumbs and the sidebar before a workspace has registered itself.
 * Loaded on demand (not in the layout) and cached 30 s on the client so a
 * newly created event shows up without a reload. Each list is returned only
 * if the member can read it.
 */
export async function loadShellEntitiesAction(): Promise<ShellEntities> {
  const events = await requireOrgPermission("event:read")
    .then(async ({ organizationId }) => {
      // Group documents are needed for module resolution whatever the member may read.
      const [permissions, orgDoc, groupDocs, eventDocs] = await Promise.all([
        memberPermissions(organizationId),
        organizationRepository.findById(organizationId),
        listGroupsForOrg(organizationId),
        listEventsForOrg(organizationId),
      ]);
      const groupById = new Map(groupDocs.map((group) => [String(group._id), group]));
      return eventDocs.slice(0, MAX_EVENTS).map((event) => {
        const group = event.groupId ? (groupById.get(String(event.groupId)) ?? null) : null;
        const modules = resolveModulesFromDocs(orgDoc, group, event);
        return {
          id: String(event._id),
          name: event.name,
          groupId: event.groupId ? String(event.groupId) : null,
          startDate: event.startDate ? new Date(event.startDate).toISOString().slice(0, 10) : "",
          tools: filterEventTools(PALETTE_TOOLS, { permissions, isOn: modules.isOn, hasVipList: Boolean(event.vipListId) }).map((tool) => tool.key),
        };
      });
    })
    .catch(() => []);
  const groups = await requireOrgPermission("group:read")
    .then(async ({ organizationId }) => (await listGroupsForOrg(organizationId)).map((group) => ({ id: String(group._id), name: group.name })))
    .catch(() => []);
  return { events, groups };
}
