import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, FolderKanban } from "lucide-react";
import { listEventsForOrg, listGroupsForOrg } from "@tbook/services";
import { EventSwitcher } from "@/components/shell/event-switcher";
import { WorkspaceHeader } from "@/components/shell/workspace-header";
import { Badge } from "@/components/ui/badge";
import { requireAdminPage, formatDate } from "@/lib/admin-page";
import { groupPath } from "@/lib/event-routes";
import { requireEvent } from "@/lib/require-module";
import { toneFor } from "@/lib/status-tones";
import { eventWorkspaceInfo } from "@/lib/workspace-nav";

export const dynamic = "force-dynamic";

const EVENT_STATUS_TONES = { active: "success", draft: "neutral", archived: "neutral" } as const;

/**
 * The event workspace: every page under /admin/events/[eventId]/… renders
 * below this header — the event's name and status, an event switcher that
 * keeps the current tool, and tabs for the tools that are ON for this event
 * and open to this member. (`/admin/events/new` is the create form, not a workspace.)
 */
export default async function EventWorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (eventId === "new") return children;

  const { organizationId, permissions } = await requireAdminPage("event:read");
  const event = await requireEvent(organizationId, eventId);
  const [info, events, groups] = await Promise.all([eventWorkspaceInfo(organizationId, permissions, event), listEventsForOrg(organizationId), listGroupsForOrg(organizationId)]);

  const groupId = event.groupId ? String(event.groupId) : null;
  const group = groupId ? groups.find((candidate) => String(candidate._id) === groupId) : undefined;

  const switcherEvents = [...events]
    .sort((a, b) => String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")))
    .map((candidate) => ({ id: String(candidate._id), name: candidate.name }));
  const sameDay = String(event.startDate) === String(event.endDate);

  return (
    <>
      <WorkspaceHeader
        info={info}
        tabsLabel="Event tools"
        status={<Badge variant={toneFor(EVENT_STATUS_TONES, event.status)}>{event.status}</Badge>}
        meta={
          <>
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <CalendarDays className="size-3.5" />
              {formatDate(event.startDate)}
              {sameDay ? "" : ` – ${formatDate(event.endDate)}`}
            </span>
            {group ? (
              permissions.has("group:read") ? (
                <Link href={groupPath(String(group._id))} className="hover:text-foreground inline-flex items-center gap-1.5 hover:underline">
                  <FolderKanban className="size-3.5" />
                  {group.name}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <FolderKanban className="size-3.5" />
                  {group.name}
                </span>
              )
            ) : null}
          </>
        }
        switcher={<EventSwitcher events={switcherEvents} value={eventId} />}
      />
      {children}
    </>
  );
}
