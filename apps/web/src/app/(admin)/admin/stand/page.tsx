import { Store } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EventPicker } from "@/components/event-picker";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { requireAdminPage } from "@/lib/admin-page";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { toDayDto } from "./dto";
import { OpenDayForm } from "./open-day-form";
import { SellScreen } from "./sell-screen";
import { standEvents, stand } from "./shared";
import { StandTabs } from "./stand-tabs";

export const dynamic = "force-dynamic";

export default async function StandPage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const { eventId: requested } = await searchParams;
  const { organizationId, permissions } = await requireAdminPage("stand:operate");
  const { events, event } = await standEvents(organizationId, requested);
  if (!event) {
    return (
      <>
        <PageTitle title="Pult" />
        <SectionCard>
          <EmptyState icon={<Store />} title="No event uses stand mode" hint="Switch on “Stand mode” in an event's Modules section." />
        </SectionCard>
      </>
    );
  }
  const eventId = String(event._id);
  const manage = hasPermissionOrFallback(permissions, "stand:manage");
  const [openDay, settings] = await Promise.all([stand.getOpenDay(eventId), stand.standSettings(event)]);
  const today = stand.todayKey();
  const proposal = openDay ? null : await stand.proposeOpening(eventId, today);
  const products = openDay ? await stand.listProducts(eventId, { activeOnly: true }) : [];
  const missing = openDay ? products.filter((p) => !openDay.lines.some((l) => String(l.productId) === String(p._id))) : [];

  return (
    <>
      <PageTitle
        title={event.name}
        description={openDay ? `Nyitva: ${openDay.date}` : "Nincs nyitott nap"}
        actions={events.length > 1 ? <EventPicker basePath="/admin/stand" events={events.map((e) => ({ id: String(e._id), name: e.name }))} value={eventId} /> : null}
      />
      <StandTabs active="sell" eventId={eventId} manage={manage} />
      {openDay ? (
        <SellScreen
          key={String(openDay._id)}
          eventId={eventId}
          initial={toDayDto(openDay)}
          packs={settings.packs}
          defaultEmail={settings.reportEmail}
          missing={missing.map((p) => ({ id: String(p._id), name: p.name }))}
        />
      ) : (
        <OpenDayForm
          eventId={eventId}
          date={today}
          previousDate={proposal!.previousDate}
          items={proposal!.items}
          manage={manage}
        />
      )}
    </>
  );
}
