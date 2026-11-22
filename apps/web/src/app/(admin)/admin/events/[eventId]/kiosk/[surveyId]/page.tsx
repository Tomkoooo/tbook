import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { FEEDBACK, feedback } from "@tbook/modules";
import { SurveyForm } from "@/components/feedback/survey-form";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/page-title";
import { requireOrgPermission } from "@/lib/admin-auth";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { requireEvent, requireEventModule } from "@/lib/require-module";

export const dynamic = "force-dynamic";

/** The kiosk screen for a signed-in member: same form and storage as the kiosk link. */
export default async function StaffKioskPage({ params }: { params: Promise<{ eventId: string; surveyId: string }> }) {
  const { eventId, surveyId } = await params;
  const { organizationId, permissions } = await requireAdminPage("feedback:kiosk");
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, FEEDBACK, "Kiosk");
  if (off) return off;
  // The kiosk must belong to the event in the path (getSurveyForOrg also checks the organization).
  const survey = await feedback.getSurveyForOrg(organizationId, surveyId).catch((error) => {
    if (error instanceof ActionError) return null;
    throw error;
  });
  if (!survey || String(survey.eventId) !== eventId) notFound();
  const kiosk = await feedback.getKioskForOrg(organizationId, surveyId);
  if (!kiosk) notFound();

  async function submit(answers: Record<string, string | number>) {
    "use server";
    try {
      const context = await requireOrgPermission("feedback:kiosk");
      await feedback.submitKioskForOrg(context.organizationId, surveyId, answers);
      return { ok: true };
    } catch (error) {
      if (error instanceof ActionError) return { ok: false, message: error.message };
      console.error("[staff kiosk submit]", error);
      return { ok: false, message: "Valami hiba történt. Próbáld újra." };
    }
  }

  return (
    <>
      <PageTitle
        title={kiosk.title}
        description={kiosk.eventName}
        back={{ href: eventPath(eventId, "kiosk"), label: "Kiosk" }}
        actions={
          hasPermissionOrFallback(permissions, "feedback:manage") ? (
            <Button asChild variant="outline">
              <Link href={eventPath(eventId, "feedback", surveyId)}>Results</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="mx-auto grid w-full max-w-3xl gap-8 py-6">
        {kiosk.intro ? <p className="text-muted-foreground text-center text-xl whitespace-pre-line">{kiosk.intro}</p> : null}
        <SurveyForm questions={kiosk.questions} ratingMax={kiosk.ratingMax} mode="kiosk" needsCode={false} thankYou={kiosk.thankYou} submit={submit} />
      </div>
    </>
  );
}
