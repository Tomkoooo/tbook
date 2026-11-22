"use server";

import { listEventsForOrg, listGroupsForOrg } from "@tbook/services";
import { requireOrgPermission } from "@/lib/admin-auth";

export interface ShellEntities {
  events: Array<{ id: string; name: string; groupId: string | null; startDate: string }>;
  groups: Array<{ id: string; name: string }>;
}

const MAX_EVENTS = 300;

/**
 * Names of the organization's events and groups, for the command palette
 * and the header breadcrumb. Loaded on demand (not in the layout) so a
 * newly created event shows up without a reload. Each list is returned only
 * if the member can read it.
 */
export async function loadShellEntitiesAction(): Promise<ShellEntities> {
  const events = await requireOrgPermission("event:read")
    .then(async ({ organizationId }) =>
      (await listEventsForOrg(organizationId)).slice(0, MAX_EVENTS).map((event) => ({
        id: String(event._id),
        name: event.name,
        groupId: event.groupId ? String(event.groupId) : null,
        startDate: event.startDate ? new Date(event.startDate).toISOString().slice(0, 10) : "",
      })),
    )
    .catch(() => []);
  const groups = await requireOrgPermission("group:read")
    .then(async ({ organizationId }) => (await listGroupsForOrg(organizationId)).map((group) => ({ id: String(group._id), name: group.name })))
    .catch(() => []);
  return { events, groups };
}
