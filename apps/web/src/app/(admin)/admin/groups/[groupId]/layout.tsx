import type { ReactNode } from "react";
import { ActionError } from "@tbook/actions";
import { notFound } from "next/navigation";
import { getGroupForOrg } from "@tbook/services";
import { WorkspaceHeader } from "@/components/shell/workspace-header";
import { Badge } from "@/components/ui/badge";
import { requireAdminPage } from "@/lib/admin-page";
import { toneFor } from "@/lib/status-tones";
import { groupWorkspaceInfo } from "@/lib/workspace-nav";

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

  const info = await groupWorkspaceInfo(organizationId, permissions, group);

  return (
    <>
      <WorkspaceHeader
        info={info}
        tabsLabel="Event group tools"
        status={<Badge variant={toneFor(GROUP_STATUS_TONES, group.status)}>{group.status}</Badge>}
        meta={group.description ? <span className="truncate">{group.description}</span> : null}
      />
      {children}
    </>
  );
}
