import { notFound } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { getGroupForOrg } from "@tbook/services";
import { requireAdminPage } from "@/lib/admin-page";
import { PageTitle } from "@/components/page-title";
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

  if (!canWrite) {
    return <PageTitle title={group.name} description="You have read-only access to this group." />;
  }

  return (
    <>
      <PageTitle title={group.name} />
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
