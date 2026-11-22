import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { organizationRepository } from "@tbook/db";
import { getGroupForOrg, listEventsForOrg, resolveModulesFromDocs } from "@tbook/services";
import { formatDate, requireAdminPage } from "@/lib/admin-page";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { EventToolsNav } from "@/components/shell/event-tools-nav";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EVENT_TOOLS, GROUP_TOOL_KEYS, filterEventTools } from "@/lib/event-tools";
import { EMPTY_GROUP, GroupForm } from "./group-form";

export const dynamic = "force-dynamic";

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { organizationId, permissions } = await requireAdminPage("group:read");
  const canManageKey = permissions.has("group:apiKey");
  const canWrite = permissions.has("group:write");

  if (groupId === "new") {
    await requireAdminPage("group:write");
    return (
      <>
        <PageTitle title="New event group" />
        <GroupForm groupId={null} initial={EMPTY_GROUP} canManageKey={false} />
      </>
    );
  }

  const group = await getGroupForOrg(organizationId, groupId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!group) notFound();

  // What is on for the group itself (group-level tools) and for each of its events.
  const org = await organizationRepository.findById(organizationId);
  const groupModules = resolveModulesFromDocs(org, group, null);
  const groupTools = filterEventTools(
    EVENT_TOOLS.filter((tool) => GROUP_TOOL_KEYS.includes(tool.key)),
    { permissions, isOn: groupModules.isOn },
  );
  const groupEvents = (await listEventsForOrg(organizationId)).filter((event) => event.groupId && String(event.groupId) === groupId);
  const eventRows = groupEvents.map((event) => {
    const modules = resolveModulesFromDocs(org, group, event);
    const tools = filterEventTools(
      EVENT_TOOLS.filter((tool) => !GROUP_TOOL_KEYS.includes(tool.key) && tool.key !== "data" && tool.key !== "preview" && tool.key !== "reports"),
      { permissions, isOn: modules.isOn, hasVipList: Boolean(event.vipListId) },
    );
    return { id: String(event._id), name: event.name, startDate: event.startDate, status: event.status, tools: tools.map((tool) => tool.label) };
  });
  const hub = (
    <>
      <EventToolsNav
        tools={groupTools}
        context={{ eventId: "", groupId }}
        title="Group tools"
        description="Tools shared by every event in this group."
        emptyHint="Nothing group-wide is switched on. Tools such as buses, waitlist and emails are switched on per event: open an event below."
      />
      <SectionCard title="Events in this group" description="Open an event for its guests, buses, emails and the rest of its tools." flush>
        {eventRows.length === 0 ? (
          <EmptyState title="No events in this group yet" hint="Create an event and choose this group." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tools switched on</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eventRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link className="font-medium hover:underline" href={`/admin/events/${row.id}`}>
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDate(row.startDate)}</TableCell>
                  <TableCell>
                    <Badge variant={row.status === "active" ? "default" : "secondary"}>{row.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {row.tools.length === 0 ? (
                      <span className="text-muted-foreground text-sm">None</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {row.tools.map((label) => (
                          <Badge key={label} variant="outline">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
  const back = { href: "/admin/groups", label: "Event groups" };

  if (!canWrite) {
    return (
      <>
        <PageTitle title={group.name} description="You have read-only access to this group." back={back} />
        {hub}
      </>
    );
  }

  return (
    <>
      <PageTitle title={group.name} back={back} />
      {hub}
      <GroupForm
        groupId={groupId}
        canManageKey={canManageKey}
        apiKeyHint={group.apiKeyHint}
        previewKeyHint={group.previewKeyHint ?? ""}
        initial={{
          name: group.name,
          description: group.description ?? "",
          status: group.status,
          defaultPriceBasis: group.defaultPriceBasis,
          defaultVatPercent: group.defaultVatPercent,
          listOnTBookSite: group.listOnTBookSite,
          listingTitle: group.listingTitle ?? "",
          listingUrl: group.listingUrl ?? "",
        }}
      />
    </>
  );
}
