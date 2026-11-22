import { PageTitle } from "@/components/page-title";
import { STAND_MODE } from "@tbook/modules";
import { requireAdminPage } from "@/lib/admin-page";
import { requireEvent, requireEventModule } from "@/lib/require-module";
import type { StandWithdrawalDto } from "../actions";
import { StandTabs } from "../stand-tabs";
import { stand } from "../shared";
import { SafePanel } from "./safe-panel";

export const dynamic = "force-dynamic";

export default async function StandSafePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { organizationId } = await requireAdminPage("stand:manage");
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, STAND_MODE, "Stand mode");
  if (off) return off;
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
          <StandTabs active="safe" eventId={eventId} manage />
        }
      />
      <SafePanel eventId={eventId} rows={rows} />
    </>
  );
}
