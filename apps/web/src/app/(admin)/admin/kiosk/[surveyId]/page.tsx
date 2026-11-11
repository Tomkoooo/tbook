import { notFound } from "next/navigation";
import { ActionError } from "@tbook/actions";
import { feedback } from "@tbook/modules";
import { SurveyForm } from "@/components/feedback/survey-form";
import { PageTitle } from "@/components/page-title";
import { requireOrgPermission } from "@/lib/admin-auth";
import { requireAdminPage } from "@/lib/admin-page";

export const dynamic = "force-dynamic";

/** The kiosk screen for a signed-in member: same form and storage as the kiosk link. */
export default async function StaffKioskPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  const { organizationId } = await requireAdminPage("feedback:kiosk");
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
      <PageTitle title={kiosk.title} description={kiosk.eventName} back={{ href: "/admin/kiosk", label: "Kiosk" }} />
      <div className="mx-auto grid w-full max-w-3xl gap-8 py-6">
        {kiosk.intro ? <p className="text-muted-foreground text-center text-xl whitespace-pre-line">{kiosk.intro}</p> : null}
        <SurveyForm questions={kiosk.questions} ratingMax={kiosk.ratingMax} mode="kiosk" needsCode={false} thankYou={kiosk.thankYou} submit={submit} />
      </div>
    </>
  );
}
