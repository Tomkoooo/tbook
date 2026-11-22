import { eventDayKeys, todayDayKey } from "@tbook/domain";
import { STAND_MODE } from "@tbook/modules";
import { listEventsForOrg, resolveModules } from "@tbook/services";

/**
 * Events of the organization that have stand mode switched on, today's events
 * first (then the rest in the catalog's order). Feeds the stand station picker.
 */
export async function standEvents(organizationId: string, now: Date = new Date()) {
  const today = todayDayKey(now);
  const rows = [];
  for (const event of await listEventsForOrg(organizationId)) {
    if (!(await resolveModules({ organizationId, event })).isOn(STAND_MODE)) continue;
    rows.push({ event, today: eventDayKeys(event.startDate, event.endDate).includes(today) });
  }
  return [...rows.filter((row) => row.today), ...rows.filter((row) => !row.today)];
}
