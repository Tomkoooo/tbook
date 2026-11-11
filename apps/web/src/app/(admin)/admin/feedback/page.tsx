import Link from "next/link";
import { MessageSquareHeart, Plus } from "lucide-react";
import { FEEDBACK, feedback } from "@tbook/modules";
import { listEventsForOrg, resolveModules } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { EventPicker } from "@/components/event-picker";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";

export const dynamic = "force-dynamic";

export default async function FeedbackListPage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const { eventId: requested } = await searchParams;
  const { organizationId } = await requireAdminPage("feedback:manage");

  const events = [];
  for (const event of await listEventsForOrg(organizationId)) {
    if ((await resolveModules({ organizationId, event })).isOn(FEEDBACK)) events.push(event);
  }
  const event = events.find((e) => String(e._id) === requested) ?? events[0] ?? null;
  if (!event) {
    return (
      <>
        <PageTitle title="Feedback" />
        <SectionCard>
          <EmptyState icon={<MessageSquareHeart />} title="No event collects feedback" hint="Switch on “Feedback” in an event's Modules section." />
        </SectionCard>
      </>
    );
  }
  const eventId = String(event._id);
  const surveys = await feedback.listSurveys(eventId);

  return (
    <>
      <PageTitle
        title="Feedback"
        description="Surveys go to guests by email ({{feedbackUrl}} is each guest's personal link) or through the website API. A kiosk runs on a tablet at the venue."
        actions={
          <>
            {events.length > 1 ? <EventPicker basePath="/admin/feedback" events={events.map((e) => ({ id: String(e._id), name: e.name }))} value={eventId} /> : null}
            <Button asChild>
              <Link href={`/admin/feedback/new?eventId=${eventId}`}>
                <Plus /> New survey
              </Link>
            </Button>
          </>
        }
      />
      <SectionCard title={event.name} flush>
        {surveys.length === 0 ? (
          <EmptyState title="No surveys yet" hint="Create a post-event survey, or a kiosk for on-site ratings." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Survey</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Answers</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {surveys.map((survey) => (
                <TableRow key={String(survey._id)}>
                  <TableCell>
                    <Link className="font-medium underline-offset-4 hover:underline" href={`/admin/feedback/${String(survey._id)}`}>
                      {survey.title}
                    </Link>
                  </TableCell>
                  <TableCell>{survey.kind === "kiosk" ? "Kiosk" : "Survey"}</TableCell>
                  <TableCell className="tabular-nums">{survey.responseCount}</TableCell>
                  <TableCell>
                    <Badge variant={survey.active ? "default" : "outline"}>{survey.active ? "Open" : "Closed"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
