import Link from "next/link";
import { Tablet } from "lucide-react";
import { feedback } from "@tbook/modules";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";

export const dynamic = "force-dynamic";

/** Kiosks a signed-in member (feedback:kiosk) can start on this device — no link needed. */
export default async function KioskListPage() {
  const { organizationId } = await requireAdminPage("feedback:kiosk");
  const kiosks = await feedback.listOpenKiosks(organizationId);

  return (
    <>
      <PageTitle title="Kiosk" description="Start a rating kiosk on this tablet. Answers are anonymous and the screen resets after each one." />
      <SectionCard>
        {kiosks.length === 0 ? (
          <EmptyState icon={<Tablet />} title="No kiosk is open" hint="An organizer creates kiosks under Feedback (type “Kiosk”, active)." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {kiosks.map((kiosk) => (
              <li key={kiosk.id} className="grid gap-2 rounded-lg border p-4">
                <p className="text-muted-foreground text-sm">{kiosk.eventName}</p>
                <p className="font-medium">{kiosk.title}</p>
                <div>
                  <Button asChild>
                    <Link href={`/admin/kiosk/${kiosk.id}`}>Start kiosk</Link>
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
