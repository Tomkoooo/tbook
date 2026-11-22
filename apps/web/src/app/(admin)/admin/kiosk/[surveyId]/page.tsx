import { notFound, redirect } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { feedback } from "@tbook/modules";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";

export const dynamic = "force-dynamic";

/** Old URL `/admin/kiosk/[surveyId]`: a kiosk knows its event. */
export default async function LegacyKioskPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  const { organizationId } = await requireAdminPage("feedback:kiosk");
  const survey = await feedback.getSurveyForOrg(organizationId, surveyId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!survey) notFound();
  redirect(eventPath(String(survey.eventId), "kiosk", surveyId));
}
