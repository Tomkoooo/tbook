import { getOrganizationSettings } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";
import { SettingsNav } from "../settings-nav";
import { BookingEmailForm } from "./booking-email-form";

export const dynamic = "force-dynamic";

export default async function BookingEmailSettingsPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { organizationId } = await requireAdminPage("org:update");
  const [{ bookingEmail }, { reset }] = await Promise.all([getOrganizationSettings(organizationId), searchParams]);

  return (
    <>
      <PageTitle
        title="Settings"
        description="Payments, invoicing, email and connections to other systems."
        actions={<Badge variant={bookingEmail.isCustom ? "info" : "neutral"}>{bookingEmail.isCustom ? "Custom email" : "Default email"}</Badge>}
      />
      <SettingsNav active="email" />
      {reset ? <Notice tone="success">Reset to the default email.</Notice> : null}
      {/* key: remount the editor with fresh content after a reset */}
      <BookingEmailForm key={`${bookingEmail.subject}|${bookingEmail.body.length}`} subject={bookingEmail.subject} body={bookingEmail.body} isCustom={bookingEmail.isCustom} />
    </>
  );
}
