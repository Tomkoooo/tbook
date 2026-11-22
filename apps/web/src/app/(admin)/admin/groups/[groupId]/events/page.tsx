import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { ActionError } from "@tbook/actions";
import { organizationRepository } from "@tbook/db";
import { getGroupForOrg } from "@tbook/services";
import { PageTitle } from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { requireAdminPage } from "@/lib/admin-page";
import { GroupEventsTable } from "../group-events-table";
import { loadGroupEventRows } from "../group-events";

export const dynamic = "force-dynamic";

/** The events of one group (the layout has already checked the group exists in this organization). */
export default async function GroupEventsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { organizationId, permissions } = await requireAdminPage("group:read");
  const group = await getGroupForOrg(organizationId, groupId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!group) notFound();
  const org = await organizationRepository.findById(organizationId);
  const rows = await loadGroupEventRows(organizationId, org, group, permissions);

  return (
    <>
      <PageTitle
        title="Events"
        description="The events of this group."
        actions={
          permissions.has("event:write") ? (
            <Button asChild>
              <Link href="/admin/events/new">
                <Plus /> New event
              </Link>
            </Button>
          ) : null
        }
      />
      <GroupEventsTable rows={rows} title="Events in this group" />
    </>
  );
}
