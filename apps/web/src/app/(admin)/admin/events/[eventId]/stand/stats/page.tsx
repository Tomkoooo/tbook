import { Banknote, CreditCard, Download, Landmark, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { FilterBar } from "@/components/filter-bar";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { Panel } from "@/components/panel";
import { STAND_MODE } from "@tbook/modules";
import { requireAdminPage } from "@/lib/admin-page";
import { eventPath, eventPathWith } from "@/lib/event-routes";
import { requireEvent, requireEventModule } from "@/lib/require-module";
import { DayActions } from "./day-actions";
import { StandTabs } from "../stand-tabs";
import { stand } from "../shared";

export const dynamic = "force-dynamic";

const ft = (n: number | null) => (n === null ? "–" : `${Math.round(n).toLocaleString("hu-HU")} Ft`);

function daysAgo(n: number): string {
  return stand.todayKey(new Date(Date.now() - n * 86_400_000));
}

export default async function StandStatsPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { eventId } = await params;
  const query = await searchParams;
  const { organizationId } = await requireAdminPage("stand:manage");
  const event = await requireEvent(organizationId, eventId);
  const off = await requireEventModule(organizationId, event, STAND_MODE, "Stand mode");
  if (off) return off;
  const from = query.from || daysAgo(29);
  const to = query.to || stand.todayKey();
  const [{ summary: s, days }, settings, withdrawals] = await Promise.all([stand.standStats(eventId, from, to), stand.standSettings(event), stand.listWithdrawals(eventId, from, to)]);
  const withdrawn = withdrawals.filter((w) => !w.stornoed).reduce((sum, w) => sum + w.amountHuf, 0);
  const exportHref = eventPathWith(eventId, "stand", { from, to }, "export");
  const latestClosedId = [...days].reverse().find((d) => d.status === "closed" && !d.manual) ? String([...days].reverse().find((d) => d.status === "closed" && !d.manual)!._id) : null;

  return (
    <>
      <PageTitle title="Statisztika" description={event.name} />
      <StandTabs active="stats" eventId={eventId} manage />
      <FilterBar action={eventPath(eventId, "stand", "stats")} submitLabel="Szűrés">
        <FormField label="Től">
          <Input type="date" name="from" defaultValue={from} />
        </FormField>
        <FormField label="Ig">
          <Input type="date" name="to" defaultValue={to} />
        </FormField>
        <div className="flex items-end">
          <Button asChild variant="outline">
            <a href={exportHref}>
              <Download /> Excel letöltése
            </a>
          </Button>
        </div>
      </FilterBar>

      {s.days === 0 ? (
        <SectionCard>
          <EmptyState title="Nincs nap ebben az időszakban" />
        </SectionCard>
      ) : (
        <>
          {!s.profitComplete ? <Notice tone="info">A nyereség csak azokat a termékeket tartalmazza, amelyeknek meg van adva a beszerzési ára.</Notice> : null}
          <KpiGrid cols={4}>
            <KpiTile tone="success" icon={<Banknote />} label="Napi bevétel" value={ft(s.revenue)} hint={`${s.itemsSold} db, ${s.days} nap${s.byDay.some((d) => d.inventory) ? "" : " · visszaváltási díjjal"}`} />
            <KpiTile tone="info" icon={<Wallet />} label="Kasszában (készpénz, váltóval)" value={ft(s.cashInRegister)} hint={`készpénz ${ft(s.cash)} + váltó ${ft(s.floatHuf)}`} />
            <KpiTile tone="info" icon={<CreditCard />} label="Kártya" value={ft(s.card)} />
            <KpiTile tone="success" icon={<Landmark />} label="Kassza összesen" value={ft(s.registerTotal)} hint="készpénz + kártya, váltóval" />
          </KpiGrid>
          <KpiGrid cols={4}>
            <KpiTile label="Belső kassza kivét" value={ft(withdrawn)} hint="a széfből, a kasszától külön" />
            <KpiTile label="Ebből visszaváltási díj" value={ft(s.deposit)} hint="nem nyereség" />
            <KpiTile label="Nettó bevétel" value={ft(s.netRevenue)} hint="visszaváltási díj nélkül" />
            <KpiTile label="Nyereség" value={ft(s.profit)} hint={`költség: ${ft(s.cost)}`} />
            <KpiTile tone="note" label="Belső fogyasztás" value={`${s.internalItems} db`} hint={`értéke: ${ft(s.internalValue)}${s.internalOutsideItems ? ` · ebből standon kívül ${s.internalOutsideItems} db` : ""}`} />
            <KpiTile label="Belső fogy. költsége" value={ft(s.internalCost)} />
            <KpiTile label="Nyereség belső fogy. után" value={ft(s.profitAfterInternal)} />
            <KpiTile tone="warning" label="Készletcsökkentés" value={`${s.adjustedItems} db`} hint="korrekciók, eladás és storno nélkül" />
            <KpiTile tone={s.variance < 0 ? "danger" : "neutral"} label="Leltárkülönbség" value={`${s.variance} db`} hint={ft(s.varianceValue)} />
          </KpiGrid>

          <Panel title="Termékek" flush>
            <DataTable
              rows={s.byProduct}
              rowKey={(p) => p.productId}
              maxHeight="lg"
              caption="Termékek"
              columns={[
                { key: "name", header: "Termék", mobile: "title", className: "font-medium", cell: (p) => p.name },
                { key: "opening", header: "Nyitó", align: "right", cell: (p) => p.opening },
                { key: "restocked", header: "Bevét.", align: "right", hideBelow: "md", cell: (p) => p.restocked },
                { key: "sold", header: "Eladott", align: "right", cell: (p) => p.sold },
                { key: "split", header: "Kp. / kártya", align: "right", hideBelow: "lg", cell: (p) => `${p.soldCash} / ${p.soldCard}` },
                { key: "internal", header: "Belső", align: "right", hideBelow: "md", cell: (p) => `${p.internal}${p.internalOutside ? ` (${p.internalOutside} kívül)` : ""}` },
                { key: "adjusted", header: "Korrekció", align: "right", hideBelow: "md", cell: (p) => (p.adjusted ? `−${p.adjusted}` : 0) },
                { key: "closing", header: "Záró", align: "right", className: "font-medium", cell: (p) => p.closing },
                { key: "revenue", header: "Bevétel", align: "right", cell: (p) => ft(p.revenue) },
                { key: "deposit", header: "Visszav. érték", align: "right", hideBelow: "xl", cell: (p) => ft(p.deposit) },
                { key: "profit", header: "Nyereség", align: "right", hideBelow: "lg", cell: (p) => ft(p.profit) },
                { key: "internalValue", header: "Belső értéke", align: "right", hideBelow: "xl", cell: (p) => ft(p.internalValue) },
              ]}
            />
          </Panel>

          <Panel title="Napok" flush>
            <DataTable
              rows={s.byDay.map((row, i) => ({ row, day: days[i]! }))}
              rowKey={({ row }) => row.date}
              mobileCards
              caption="Napok"
              columns={[
                {
                  key: "date",
                  header: "Nap",
                  mobile: "title",
                  className: "font-medium",
                  cell: ({ row, day }) => (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {row.date}
                      {day.status === "open" ? <Badge variant="success">nyitva</Badge> : null}
                      {row.manual ? <Badge variant="outline">utólag rögzítve</Badge> : null}
                      {row.inventory ? <Badge variant="outline">leltár + összesítő</Badge> : null}
                    </span>
                  ),
                },
                { key: "revenue", header: "Bevétel", align: "right", className: "font-semibold", cell: ({ row }) => ft(row.revenue) },
                {
                  key: "cash",
                  header: "Készpénz",
                  align: "right",
                  cell: ({ row }) => (
                    <>
                      {ft(row.cash)} {row.cashCounted ? <Badge variant="outline">megadott</Badge> : null}
                    </>
                  ),
                },
                { key: "card", header: "Kártya", align: "right", cell: ({ row }) => ft(row.card) },
                { key: "float", header: "Váltó", align: "right", hideBelow: "md", cell: ({ row }) => ft(row.floatHuf) },
                { key: "register", header: "Kassza összesen", align: "right", className: "font-medium", cell: ({ row }) => ft(row.registerTotal) },
                { key: "profit", header: "Nyereség", align: "right", hideBelow: "lg", cell: ({ row }) => ft(row.profit) },
                { key: "internal", header: "Belső fogy.", align: "right", hideBelow: "lg", cell: ({ row }) => `${row.internalItems} db (${ft(row.internalValue)})` },
                {
                  key: "actions",
                  header: <span className="sr-only">Műveletek</span>,
                  align: "right",
                  mobile: "footer",
                  cell: ({ day }) =>
                    day.status === "closed" ? (
                      <DayActions
                        eventId={eventId}
                        dayId={String(day._id)}
                        defaultEmail={day.reportSentTo || settings.reportEmail}
                        canReopen={String(day._id) === latestClosedId}
                        takings={day.manual ? undefined : { cashHuf: day.takings?.cashHuf ?? 0, cardHuf: day.takings?.cardHuf ?? 0, floatHuf: day.floatHuf ?? 0, entered: Boolean(day.takings) }}
                      />
                    ) : null,
                },
              ]}
            />
          </Panel>
        </>
      )}
    </>
  );
}
