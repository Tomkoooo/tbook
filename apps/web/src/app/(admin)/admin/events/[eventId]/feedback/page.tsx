import Link from "next/link";
import { Plus } from "lucide-react";
import { FEEDBACK, feedback } from "@tbook/modules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";
import { requireEvent, requireEventModule } from "@/lib/require-module";

export const dynamic = "force-dynamic";

export default async function FeedbackListPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { organizationId } = await requireAdminPage("feedback:manage");
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, FEEDBACK, "Feedback");
  if (off) return off;
  const surveys = await feedback.listSurveys(eventId);

  return (
    <>
      <PageTitle
        title="Feedback"
        back={{ href: eventPath(eventId), label: event.name }}
        description="Surveys go to guests by email ({{feedbackUrl}} is each guest's personal link) or through the website API. A kiosk runs on a tablet at the venue."
        actions={
          <Button asChild>
            <Link href={eventPath(eventId, "feedback", "new")}>
              <Plus /> New survey
            </Link>
          </Button>
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
                    <Link className="font-medium underline-offset-4 hover:underline" href={eventPath(eventId, "feedback", String(survey._id))}>
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
