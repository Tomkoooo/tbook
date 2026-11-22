import { notFound, redirect } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { feedback } from "@tbook/modules";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";

export const dynamic = "force-dynamic";

/** Old URLs `/admin/feedback/[surveyId]` and `/admin/feedback/new?eventId=`: a survey knows its event. */
export default async function LegacyFeedbackPage({ params, searchParams }: { params: Promise<{ surveyId: string }>; searchParams: Promise<{ eventId?: string }> }) {
  const { surveyId } = await params;
  const { eventId } = await searchParams;
  const { organizationId } = await requireAdminPage("feedback:manage");
  if (surveyId === "new") redirect(eventId ? eventPath(eventId, "feedback", "new") : "/admin/events");
  const survey = await feedback.getSurveyForOrg(organizationId, surveyId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!survey) notFound();
  redirect(eventPath(String(survey.eventId), "feedback", surveyId));
}
