import { listDataListsForOrg, listEventsForOrg, listImportTargets, resolveModules } from "@tbook/services";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";
import { ImportWizard } from "./import-wizard";

export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ replace?: string }> }) {
  const { replace } = await searchParams;
  const { organizationId } = await requireAdminPage("list:manage");
  const [lists, events, entitled] = await Promise.all([listDataListsForOrg(organizationId), listEventsForOrg(organizationId), resolveModules({ organizationId })]);
  const targets = listImportTargets()
    .filter((target) => !target.moduleKey || entitled.isOn(target.moduleKey))
    .map((target) => ({ key: target.key, label: target.label, description: target.description, needsEvent: target.needsEvent, fields: target.fields.map((field) => ({ ...field })) }));

  return (
    <>
      <PageTitle
        title="Import a spreadsheet"
        description="Upload an .xlsx or .csv, then choose what its rows become and which column is which. Nothing is saved until the last step."
        back={{ href: "/admin/data", label: "Data" }}
      />
      <ImportWizard
        targets={targets}
        lists={lists.map((list) => ({ id: String(list._id), name: list.name }))}
        events={events.map((event) => ({ id: String(event._id), name: event.name }))}
        replaceListId={replace && lists.some((list) => String(list._id) === replace) ? replace : null}
      />
    </>
  );
}
