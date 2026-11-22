import { listEventsForOrg, resolveModules } from "@tbook/services";
import { orderTodayFirst } from "./station-events";

/**
 * Events of the organization that have `moduleKey` switched on (per event:
 * organization → group → event), today's events first. Feeds the door and
 * counter station pickers. `activeOnly` drops events that are not on sale.
 */
export async function stationEvents(organizationId: string, moduleKey: string, options: { activeOnly?: boolean; now?: Date } = {}) {
  const candidates = (await listEventsForOrg(organizationId)).filter((event) => !options.activeOnly || event.status === "active");
  const enabled = await Promise.all(candidates.map(async (event) => (await resolveModules({ organizationId, event })).isOn(moduleKey)));
  return orderTodayFirst(candidates.filter((_, index) => enabled[index]), options.now);
}
