import { FEEDBACK } from "@tbook/modules";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";
import { requireEvent, requireEventModule } from "@/lib/require-module";
import { SurveyEditor } from "../survey-editor";

export const dynamic = "force-dynamic";

export default async function NewSurveyPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { organizationId } = await requireAdminPage("feedback:manage");
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, FEEDBACK, "Feedback");
  if (off) return off;
  return (
    <>
      <PageTitle back={{ href: eventPath(eventId, "feedback"), label: "Feedback" }} title="New survey" description={event.name} />
      <SectionCard>
        <SurveyEditor
          eventId={eventId}
          value={{ id: null, kind: "survey", title: "", intro: "", thankYou: "", active: true, questions: [] }}
        />
      </SectionCard>
    </>
  );
}
