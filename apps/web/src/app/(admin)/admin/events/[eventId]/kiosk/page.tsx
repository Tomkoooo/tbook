import Link from "next/link";
import { Tablet } from "lucide-react";
import { FEEDBACK, feedback } from "@tbook/modules";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath } from "@/lib/event-routes";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { requireEvent, requireEventModule } from "@/lib/require-module";

export const dynamic = "force-dynamic";

/** The event's kiosks a signed-in member (feedback:kiosk) can start on this device — no link needed. */
export default async function KioskListPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { organizationId, permissions } = await requireAdminPage("feedback:kiosk");
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, FEEDBACK, "Kiosk");
  if (off) return off;
  // The module is on for this event (guarded above), so every active kiosk of the event is open.
  const kiosks = (await feedback.listSurveys(eventId)).filter((survey) => survey.kind === "kiosk" && survey.active);
  const canManage = hasPermissionOrFallback(permissions, "feedback:manage");

  return (
    <>
      <PageTitle
        title="Kiosk"
        back={{ href: eventPath(eventId), label: event.name }}
        description="Start a rating kiosk on this tablet. Answers are anonymous and the screen resets after each one."
        actions={
          canManage ? (
            <Button asChild variant="outline">
              <Link href={eventPath(eventId, "feedback")}>Feedback results</Link>
            </Button>
          ) : undefined
        }
      />
      <SectionCard>
        {kiosks.length === 0 ? (
          <EmptyState icon={<Tablet />} title="No kiosk is open" hint="An organizer creates kiosks under Feedback (type “Kiosk”, active)." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {kiosks.map((kiosk) => (
              <li key={String(kiosk._id)} className="grid gap-2 rounded-lg border p-4">
                <p className="text-muted-foreground text-sm">{event.name}</p>
                <p className="font-medium">{kiosk.title}</p>
                <div>
                  <Button asChild>
                    <Link href={eventPath(eventId, "kiosk", String(kiosk._id))}>Start kiosk</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
