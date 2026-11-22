import type { IEventGroup, IOrganization } from "@tbook/db";
import { listEventsForOrg, resolveModulesFromDocs } from "@tbook/services";
import { EVENT_TOOLS, filterEventTools } from "@/lib/event-tools";
import type { GroupEventRow } from "./group-events-table";

/** The group's events with the labels of their tools that are on and open to the member. */
export async function loadGroupEventRows(organizationId: string, org: IOrganization | null, group: IEventGroup, permissions: Iterable<string>): Promise<GroupEventRow[]> {
  const groupId = String(group._id);
  const events = (await listEventsForOrg(organizationId)).filter((event) => event.groupId && String(event.groupId) === groupId);
  return events.map((event) => {
    const modules = resolveModulesFromDocs(org, group, event);
    const tools = filterEventTools(
      EVENT_TOOLS.filter((tool) => tool.key !== "preview" && tool.key !== "reports"),
      { permissions, isOn: modules.isOn, hasVipList: Boolean(event.vipListId) },
    );
    return { id: String(event._id), name: event.name, startDate: event.startDate, status: event.status, tools: tools.map((tool) => tool.shortLabel ?? tool.label) };
  });
}
