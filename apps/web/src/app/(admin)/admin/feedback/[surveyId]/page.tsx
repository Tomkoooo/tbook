import Link from "next/link";
import { Download } from "lucide-react";
import { feedback } from "@tbook/modules";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { Stat } from "@/components/stat";
import { requireAdminPage } from "@/lib/admin-page";
import { KioskLinkPanel, SurveyEditor } from "../survey-editor";

export const dynamic = "force-dynamic";

export default async function SurveyPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  const { organizationId } = await requireAdminPage("feedback:manage");
  const { survey, total, bySource, questions } = await feedback.surveyResults(organizationId, surveyId);
  const eventId = String(survey.eventId);
  const ratings = questions.filter((q) => q.average != null);
  const overall = ratings.length ? ratings.reduce((sum, q) => sum + q.average!, 0) / ratings.length : null;

  return (
    <>
      <PageTitle
        back={{ href: `/admin/feedback?eventId=${eventId}`, label: "Feedback" }}
        title={survey.title}
        description={survey.kind === "kiosk" ? "Kiosk — anonymous taps at the venue" : "Survey — once per guest, stored anonymously"}
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/feedback/${surveyId}/export`} prefetch={false}>
              <Download /> Answers (xlsx)
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Answers" value={total} />
        <Stat label="Average rating" value={overall == null ? "—" : `${overall.toFixed(2)} / ${feedback.RATING_MAX}`} />
        <Stat label="From the website / email" value={(bySource.survey ?? 0) + (bySource.api ?? 0)} />
        <Stat label="From the kiosk" value={bySource.kiosk ?? 0} />
      </div>

      <SectionCard title="Results">
        {total === 0 ? (
          <EmptyState title="No answers yet" />
        ) : (
          <div className="grid gap-6">
            {questions.map((result) => {
              const max = Math.max(1, ...result.counts.map((c) => c.count));
              return (
                <div key={result.question.id} className="grid gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">{result.question.label}</p>
                    <p className="text-muted-foreground text-sm tabular-nums">
                      {result.average != null ? `átlag ${result.average.toFixed(2)} · ` : ""}
                      {result.answered} answers
                    </p>
                  </div>
                  {result.counts.length > 0 ? (
                    <div className="grid gap-1">
                      {result.counts.map((count) => (
                        <div key={count.label} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-sm">
                          <span className="truncate">{result.question.type === "rating" ? `${count.label} ★` : count.label}</span>
                          <meter className="h-3 w-full" min={0} max={max} value={count.count} aria-label={`${count.label}: ${count.count}`} />
                          <span className="text-right tabular-nums">{count.count}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {result.texts.length > 0 ? (
                    <ul className="grid max-h-72 gap-1 overflow-y-auto text-sm">
                      {result.texts.map((text, index) => (
                        <li key={index} className="bg-muted rounded-md px-3 py-2 whitespace-pre-line">
                          {text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {survey.kind === "kiosk" ? (
        <SectionCard title="Kiosk link">
          <KioskLinkPanel surveyId={surveyId} hint={survey.kioskTokenHint} />
        </SectionCard>
      ) : (
        <SectionCard title="Sharing">
          <p className="text-muted-foreground text-sm">
            In an event email, <span className="font-mono">{"{{feedbackUrl}}"}</span> becomes each guest&apos;s personal link to the first open survey. Guests
            without a link enter their registration number or ID. Website: <span className="font-mono">GET /api/v1/surveys?eventId={eventId}</span>,{" "}
            <span className="font-mono">POST /api/v1/surveys/{surveyId}/responses</span>.
          </p>
        </SectionCard>
      )}

      <SectionCard title="Edit">
        <SurveyEditor
          eventId={eventId}
          value={{
            id: surveyId,
            kind: survey.kind,
            title: survey.title,
            intro: survey.intro,
            thankYou: survey.thankYou,
            active: survey.active,
            questions: survey.questions.map((q) => ({ id: q.id, type: q.type, label: q.label, required: q.required, choices: [...q.choices] })),
          }}
        />
      </SectionCard>
    </>
  );
}
