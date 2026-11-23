import { eventRepository, organizationRepository, type IEvent, type IEventGroup } from "@tbook/db";
import { getGroupForOrg, resolveModules, resolveModulesFromDocs } from "@tbook/services";
import type { WorkspaceInfo } from "@/components/shell/workspace-store";
import { eventPath, groupPath, routeContext } from "./event-routes";
import { EVENT_TOOLS, GROUP_TOOLS, eventToolLinks, filterEventTools, filterGroupTools, groupToolLinks, type ToolLink } from "./event-tools";

const overview = (href: string): ToolLink => ({ key: "overview", label: "Overview", href, icon: "overview" });

/** The tabs / sidebar links of an event workspace: the tools that are on for THIS event and open to this member. One place, so tabs, sidebar and palette agree. */
export async function eventWorkspaceInfo(organizationId: string, permissions: Iterable<string>, event: IEvent): Promise<WorkspaceInfo> {
  const eventId = String(event._id);
  const modules = await resolveModules({ organizationId, event });
  const groupId = event.groupId ? String(event.groupId) : null;
  const tools = filterEventTools(EVENT_TOOLS, { permissions, isOn: modules.isOn, hasVipList: Boolean(event.vipListId) });
  return { kind: "event", id: eventId, name: event.name, links: [overview(eventPath(eventId)), ...eventToolLinks(tools, { eventId, groupId })] };
}

export async function groupWorkspaceInfo(organizationId: string, permissions: Iterable<string>, group: IEventGroup): Promise<WorkspaceInfo> {
  const groupId = String(group._id);
  const org = await organizationRepository.findById(organizationId);
  const modules = resolveModulesFromDocs(org, group, null);
  const tools = filterGroupTools(GROUP_TOOLS, { permissions, isOn: modules.isOn });
  return {
    kind: "group",
    id: groupId,
    name: group.name,
    links: [overview(groupPath(groupId)), ...groupToolLinks(tools, groupId), { key: "events", label: "Events", href: `${groupPath(groupId)}/events`, icon: "events" }],
  };
}

/**
 * The workspace the request path is in, for the admin layout to seed the
 * sidebar and breadcrumbs with on the first render. Best effort: anything
 * unexpected (another tenant's id, a missing record) is `null` and the page
 * itself answers 404 — the shell just falls back to its client lookup.
 */
export async function workspaceSeedForPath(organizationId: string, permissions: Iterable<string>, pathname: string): Promise<WorkspaceInfo | null> {
  const context = routeContext(pathname);
  try {
    if (context.kind === "event") {
      const event = await eventRepository.findById(context.eventId);
      if (!event || String(event.organizationId) !== organizationId) return null;
      return await eventWorkspaceInfo(organizationId, permissions, event);
    }
    if (context.kind === "group") {
      const group = await getGroupForOrg(organizationId, context.groupId);
      return await groupWorkspaceInfo(organizationId, permissions, group);
    }
  } catch {
    return null;
  }
  return null;
}
