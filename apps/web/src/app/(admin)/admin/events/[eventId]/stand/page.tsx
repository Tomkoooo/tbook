import { PageTitle } from "@/components/page-title";
import { requireAdminPage } from "@/lib/admin-page";
import { hasPermissionOrFallback } from "@/lib/permission-fallbacks";
import { requireEvent, requireEventModule } from "@/lib/require-module";
import { STAND_MODE } from "@tbook/modules";
import { toDayDto } from "./dto";
import { OpenDayForm } from "./open-day-form";
import { SellScreen } from "./sell-screen";
import { stand } from "./shared";
import { StandTabs } from "./stand-tabs";

export const dynamic = "force-dynamic";

export default async function StandPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { organizationId, permissions } = await requireAdminPage("stand:operate");
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, STAND_MODE, "Stand mode");
  if (off) return off;
  const manage = hasPermissionOrFallback(permissions, "stand:manage");
  const [realDay, sandboxDay, settings] = await Promise.all([stand.getOpenDay(eventId), stand.getSandboxDay(eventId), stand.standSettings(event)]);
  // A real open day always wins; the practice run is only shown while there is none.
  const openDay = realDay ?? sandboxDay;
  const today = stand.todayKey();
  const proposal = openDay ? null : await stand.proposeOpening(eventId, today);
  const products = openDay ? await stand.listProducts(eventId, { activeOnly: true }) : [];
  const missing = openDay ? products.filter((p) => !openDay.lines.some((l) => String(l.productId) === String(p._id))) : [];

  return (
    <>
      <PageTitle
        title={event.name}
        description={openDay ? (openDay.sandbox ? "Gyakorló mód" : `Nyitva: ${openDay.date}`) : "Nincs nyitott nap"}
        actions={
          <StandTabs active="sell" eventId={eventId} manage={manage} />
        }
      />
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
          previousFloat={proposal!.floatHuf}
          items={proposal!.items}
          manage={manage}
          defaultEmail={settings.reportEmail}
        />
      )}
    </>
  );
}
