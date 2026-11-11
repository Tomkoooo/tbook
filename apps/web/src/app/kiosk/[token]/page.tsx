import "@/lib/register-modules";
import type { Metadata } from "next";
import { ActionError } from "@tbook/actions";
import { ensureDbConnection } from "@tbook/db";
import { feedback } from "@tbook/modules";
import { SurveyForm } from "@/components/feedback/survey-form";
import { allowPublicAction } from "@/lib/public-rate-limit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Értékelés", robots: { index: false, follow: false } };

/** The venue tablet: anonymous tap-to-rate, resets after each answer. The link is the access. */
export default async function KioskPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await ensureDbConnection();
  const survey = await feedback.getKiosk(token);

  if (!survey) {
    return (
      <main className="grid min-h-svh place-items-center p-4">
        <p className="text-muted-foreground text-lg">Ez a kioszk link nem aktív.</p>
      </main>
    );
  }

  async function submit(answers: Record<string, string | number>) {
    "use server";
    try {
      // A shared tablet sends from one address; allow a busy queue.
      if (!(await allowPublicAction("kiosk", 120))) return { ok: false, message: "Egy pillanat, próbáld újra." };
      await ensureDbConnection();
      await feedback.submitKiosk(token, answers);
      return { ok: true };
    } catch (error) {
      if (error instanceof ActionError) return { ok: false, message: error.message };
      console.error("[kiosk submit]", error);
      return { ok: false, message: "Valami hiba történt. Próbáld újra." };
    }
  }

  return (
    <main className="mx-auto grid min-h-svh max-w-3xl content-center gap-8 p-6">
      <header className="grid gap-2 text-center">
        <p className="text-muted-foreground text-lg">{survey.eventName}</p>
        <h1 className="text-4xl font-semibold">{survey.title}</h1>
        {survey.intro ? <p className="text-muted-foreground text-xl whitespace-pre-line">{survey.intro}</p> : null}
      </header>
      <SurveyForm questions={survey.questions} ratingMax={survey.ratingMax} mode="kiosk" needsCode={false} thankYou={survey.thankYou} submit={submit} />
    </main>
  );
}
