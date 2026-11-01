import { getOrganizationSettings } from "@tbook/services";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";
import { GeneralSettingsForm } from "./general-form";
import { SettingsNav } from "./settings-nav";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { organizationId } = await requireAdminPage("org:update");
  const settings = await getOrganizationSettings(organizationId);

  return (
    <>
      <PageTitle title="Settings" description="Payments, invoicing, email and connections to other systems." />
      <SettingsNav active="general" />
      <GeneralSettingsForm name={settings.name} slug={settings.slug} currency={settings.currency} />
    </>
  );
}
