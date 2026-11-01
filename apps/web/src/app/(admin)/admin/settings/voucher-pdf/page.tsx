import { getVoucherPdfLayout } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";
import { SettingsNav } from "../settings-nav";
import { VoucherPdfEditor } from "./voucher-pdf-editor";

export const dynamic = "force-dynamic";

export default async function VoucherPdfSettingsPage() {
  const { organizationId } = await requireAdminPage("org:update");
  const { layout, isCustom } = await getVoucherPdfLayout(organizationId);

  return (
    <>
      <PageTitle
        title="Settings"
        description="Payments, invoicing, email and connections to other systems."
        actions={<Badge variant={isCustom ? "info" : "neutral"}>{isCustom ? "Custom ticket" : "Default ticket"}</Badge>}
      />
      <SettingsNav active="voucher" />
      <VoucherPdfEditor initial={layout} isCustom={isCustom} />
    </>
  );
}
