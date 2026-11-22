import type { ReactNode } from "react";
import { ActionError } from "@tbook/actions";
import { notFound } from "next/navigation";
import { organizationRepository } from "@tbook/db";
import { getGroupForOrg, resolveModulesFromDocs } from "@tbook/services";
import { overviewLink, WorkspaceHeader } from "@/components/shell/workspace-header";
import { Badge } from "@/components/ui/badge";
import { requireAdminPage } from "@/lib/admin-page";
import { groupPath } from "@/lib/event-routes";
import { GROUP_TOOLS, filterGroupTools, groupToolLinks, type ToolLink } from "@/lib/event-tools";
import { toneFor } from "@/lib/status-tones";

export const dynamic = "force-dynamic";

const GROUP_STATUS_TONES = { active: "success", draft: "neutral", archived: "neutral" } as const;

/**
 * The event group workspace: every page under /admin/groups/[groupId]/…
 * renders below this header — name, status and tabs (Overview, the group's
 * tools such as Hotels, Events). `/admin/groups/new` is the create form.
 */
export default async function GroupWorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  if (groupId === "new") return children;

  const { organizationId, permissions } = await requireAdminPage("group:read");
  const group = await getGroupForOrg(organizationId, groupId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!group) notFound();

  const org = await organizationRepository.findById(organizationId);
  const modules = resolveModulesFromDocs(org, group, null);
  const tools = filterGroupTools(GROUP_TOOLS, { permissions, isOn: modules.isOn });
  const eventsLink: ToolLink = { key: "events", label: "Events", href: `${groupPath(groupId)}/events`, icon: "events" };
  const links = [overviewLink(groupPath(groupId)), ...groupToolLinks(tools, groupId), eventsLink];

  return (
    <>
      <WorkspaceHeader
        info={{ kind: "group", id: groupId, name: group.name, links }}
        tabsLabel="Event group tools"
        status={<Badge variant={toneFor(GROUP_STATUS_TONES, group.status)}>{group.status}</Badge>}
        meta={group.description ? <span className="truncate">{group.description}</span> : null}
      />
      {children}
    </>
  );
}
