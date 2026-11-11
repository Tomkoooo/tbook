import { getEventForOrg } from "@tbook/services";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { SurveyEditor } from "../survey-editor";

export const dynamic = "force-dynamic";

export default async function NewSurveyPage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const { eventId = "" } = await searchParams;
  const { organizationId } = await requireAdminPage("feedback:manage");
  const event = await getEventForOrg(organizationId, eventId);
  return (
    <>
      <PageTitle back={{ href: `/admin/feedback?eventId=${eventId}`, label: "Feedback" }} title="New survey" description={event.name} />
      <SectionCard>
        <SurveyEditor
          eventId={eventId}
          value={{ id: null, kind: "survey", title: "", intro: "", thankYou: "", active: true, questions: [] }}
        />
      </SectionCard>
    </>
  );
}
