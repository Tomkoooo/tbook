import "@/lib/register-modules";
import type { Metadata } from "next";
import { ensureDbConnection } from "@tbook/db";
import { feedback } from "@tbook/modules";
import { SurveyForm } from "@/components/feedback/survey-form";
import { submitFeedbackAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visszajelzés", robots: { index: false, follow: false } };

/** A guest's survey. The personal link (?t=) identifies them; otherwise they enter their registration number or ID. */
export default async function FeedbackPage({ params, searchParams }: { params: Promise<{ surveyId: string }>; searchParams: Promise<{ t?: string }> }) {
  const { surveyId } = await params;
  const { t: token = "" } = await searchParams;
  await ensureDbConnection();
  const survey = await feedback.getPublicSurvey(surveyId);

  if (!survey) {
    return (
      <main className="mx-auto grid min-h-svh max-w-md place-items-center p-4">
        <div className="bg-card grid gap-2 rounded-xl border p-6 text-center">
          <h1 className="text-lg font-semibold">Ez a kérdőív most nem elérhető</h1>
        </div>
      </main>
    );
  }

  async function submit(answers: Record<string, string | number>, code: string) {
    "use server";
    return submitFeedbackAction(surveyId, token, code, answers);
  }

  return (
    <main className="mx-auto grid max-w-xl gap-6 p-4 py-10">
      <header className="grid gap-1">
        <p className="text-muted-foreground text-sm">{survey.eventName}</p>
        <h1 className="text-2xl font-semibold">{survey.title}</h1>
        {survey.intro ? <p className="text-muted-foreground whitespace-pre-line">{survey.intro}</p> : null}
      </header>
      <div className="bg-card rounded-xl border p-6">
        <SurveyForm questions={survey.questions} ratingMax={survey.ratingMax} mode="survey" needsCode={!token} thankYou={survey.thankYou} submit={submit} />
      </div>
    </main>
  );
}
