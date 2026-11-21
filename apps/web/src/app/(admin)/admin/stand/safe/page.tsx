import { Store } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EventPicker } from "@/components/event-picker";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import type { StandWithdrawalDto } from "../actions";
import { StandTabs } from "../stand-tabs";
import { standEvents, stand } from "../shared";
import { SafePanel } from "./safe-panel";

export const dynamic = "force-dynamic";

export default async function StandSafePage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const { eventId: requested } = await searchParams;
  const { organizationId } = await requireAdminPage("stand:manage");
  const { events, event } = await standEvents(organizationId, requested);
  if (!event) {
    return (
      <SectionCard>
        <EmptyState icon={<Store />} title="No event uses stand mode" hint="Switch on “Stand mode” in an event's Modules section." />
      </SectionCard>
    );
  }
  const eventId = String(event._id);
  const rows: StandWithdrawalDto[] = (await stand.listWithdrawals(eventId)).map((w) => ({
    id: String(w._id),
    date: w.date,
    at: w.at.toISOString(),
    amountHuf: w.amountHuf,
    note: w.note,
    by: w.by,
    stornoed: w.stornoed,
  }));

  return (
    <>
      <PageTitle
        title="Belső kassza"
        description={`${event.name} · a széfből kivett pénz; nem része a kassza-riportnak`}
        actions={
          <>
            {events.length > 1 ? <EventPicker basePath="/admin/stand/safe" events={events.map((e) => ({ id: String(e._id), name: e.name }))} value={eventId} /> : null}
            <StandTabs active="safe" eventId={eventId} manage />
          </>
        }
      />
      <SafePanel eventId={eventId} rows={rows} />
    </>
  );
}
