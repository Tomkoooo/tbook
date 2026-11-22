import { notFound, redirect } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { eventEmails } from "@tbook/modules";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPathWith } from "@/lib/event-routes";

export const dynamic = "force-dynamic";

/** Old URLs `/admin/emails/[emailId]` and `/admin/emails/new?eventId=…&trigger=…`: an email knows its event. */
export default async function LegacyEmailPage({ params, searchParams }: { params: Promise<{ emailId: string }>; searchParams: Promise<{ eventId?: string; trigger?: string; status?: string }> }) {
  const { emailId } = await params;
  const { eventId, trigger, status } = await searchParams;
  const { organizationId } = await requireAdminPage("email:send");
  if (emailId === "new") redirect(eventId ? eventPathWith(eventId, "emails", { trigger }, "new") : "/admin/events");
  const email = await eventEmails.getEventEmailForOrg(organizationId, emailId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!email) notFound();
  redirect(eventPathWith(String(email.eventId), "emails", { status }, emailId));
}
