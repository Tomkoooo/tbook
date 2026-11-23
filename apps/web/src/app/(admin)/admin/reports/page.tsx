import { listEventsForOrg, listGroupsForOrg, resolveModules } from "@tbook/services";
import { parseDataTableQuery } from "@/components/data-table";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath, eventPathWith } from "@/lib/event-routes";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { readTablePrefs } from "@/lib/table-prefs";
import { ReportsTable, type ReportEventRow } from "./reports-table";

export const dynamic = "force-dynamic";

/**
 * Reports across the organization: every event with the reports that exist
 * for it — registrations (per day and per answer), the attendee list, and the
 * stand's daily closing reports. A report itself is per event, so this is the
 * way in from the sidebar; the same links sit in each event's tabs.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId, permissions } = await requireAdminPage("booking:read");
  const [events, groups, prefs] = await Promise.all([listEventsForOrg(organizationId), listGroupsForOrg(organizationId), readTablePrefs("reports")]);
  const groupName = new Map(groups.map((group) => [String(group._id), group.name]));
  const canStand = hasPermissionOrFallback(permissions, "stand:manage") || hasPermissionOrFallback(permissions, "stand:operate") || hasPermissionOrFallback(permissions, "event:write");

  const rows: ReportEventRow[] = await Promise.all(
    events.map(async (event) => {
      const id = String(event._id);
      const modules = await resolveModules({ organizationId, event });
      return {
        id,
        name: event.name,
        groupName: event.groupId ? (groupName.get(String(event.groupId)) ?? "") : "",
        status: event.status,
        startDate: new Date(event.startDate).toISOString(),
        reportHref: eventPath(id, "reports"),
        attendeesHref: modules.isOn("ticket-sales") ? eventPathWith(id, "bookings", { view: "attendees" }) : null,
        standHref: canStand && modules.isOn("stand-mode") ? eventPath(id, "stand", "stats") : null,
      };
    }),
  );

  const query = parseDataTableQuery(await searchParams, { sort: "-startDate", savedPageSize: prefs?.pageSize });
  return (
    <>
      <PageTitle title="Reports" description="Pick an event: registrations per day and per answer, the attendee list, and the stand's daily reports." />
      <ReportsTable rows={rows} query={query} prefs={prefs} />
    </>
  );
}
