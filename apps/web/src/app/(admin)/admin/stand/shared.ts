import { STAND_MODE, stand } from "@tbook/modules";
import { listEventsForOrg, resolveModules } from "@tbook/services";

/** Events of the organization that have stand mode switched on, and the one picked (`?eventId=`, else the first). */
export async function standEvents(organizationId: string, requested?: string) {
  const events = [];
  for (const event of await listEventsForOrg(organizationId)) {
    if ((await resolveModules({ organizationId, event })).isOn(STAND_MODE)) events.push(event);
  }
  const event = events.find((e) => String(e._id) === requested) ?? events[0] ?? null;
  return { events, event };
}

export { stand };
