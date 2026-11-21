import { Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { EventPicker } from "@/components/event-picker";
import { FormField } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page-title";
import { SectionCard } from "@/components/section-card";
import { Stat, StatGrid } from "@/components/stat";
import { requireAdminPage } from "@/lib/admin-page";
import { DayActions } from "./day-actions";
import { StandTabs } from "../stand-tabs";
import { standEvents, stand } from "../shared";

export const dynamic = "force-dynamic";

const ft = (n: number | null) => (n === null ? "–" : `${Math.round(n).toLocaleString("hu-HU")} Ft`);

function daysAgo(n: number): string {
  return stand.todayKey(new Date(Date.now() - n * 86_400_000));
}

export default async function StandStatsPage({ searchParams }: { searchParams: Promise<{ eventId?: string; from?: string; to?: string }> }) {
  const query = await searchParams;
  const { organizationId } = await requireAdminPage("stand:manage");
  const { events, event } = await standEvents(organizationId, query.eventId);
  if (!event) {
    return (
      <SectionCard>
        <EmptyState icon={<Store />} title="No event uses stand mode" hint="Switch on “Stand mode” in an event's Modules section." />
      </SectionCard>
    );
  }
  const eventId = String(event._id);
  const from = query.from || daysAgo(29);
  const to = query.to || stand.todayKey();
  const [{ summary: s, days }, settings, withdrawals] = await Promise.all([stand.standStats(eventId, from, to), stand.standSettings(event), stand.listWithdrawals(eventId, from, to)]);
  const withdrawn = withdrawals.filter((w) => !w.stornoed).reduce((sum, w) => sum + w.amountHuf, 0);
  const exportHref = `/admin/stand/export?eventId=${eventId}&from=${from}&to=${to}`;
  const latestClosedId = [...days].reverse().find((d) => d.status === "closed" && !d.manual) ? String([...days].reverse().find((d) => d.status === "closed" && !d.manual)!._id) : null;

  return (
    <>
      <PageTitle
        title="Statisztika"
        description={event.name}
        actions={events.length > 1 ? <EventPicker basePath="/admin/stand/stats" events={events.map((e) => ({ id: String(e._id), name: e.name }))} value={eventId} /> : null}
      />
      <StandTabs active="stats" eventId={eventId} manage />
      <form className="flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="eventId" value={eventId} />
        <FormField label="Től">
          <Input type="date" name="from" defaultValue={from} />
        </FormField>
        <FormField label="Ig">
          <Input type="date" name="to" defaultValue={to} />
        </FormField>
        <Button type="submit" variant="outline">
          Szűrés
        </Button>
        <Button asChild>
          <a href={exportHref}>Excel letöltése</a>
        </Button>
      </form>

      {s.days === 0 ? (
        <SectionCard>
          <EmptyState title="Nincs nap ebben az időszakban" />
        </SectionCard>
      ) : (
        <>
          {!s.profitComplete ? <Notice tone="info">A nyereség csak azokat a termékeket tartalmazza, amelyeknek meg van adva a beszerzési ára.</Notice> : null}
          <StatGrid>
            <Stat label="Napi bevétel" value={ft(s.revenue)} hint={`${s.itemsSold} db, ${s.days} nap · visszaváltási díjjal`} />
            <Stat label="Kasszában (készpénz, váltóval)" value={ft(s.cashInRegister)} hint={`készpénzes eladás ${ft(s.cash)} + váltó ${ft(s.floatHuf)}`} />
            <Stat label="Kártya" value={ft(s.card)} />
            <Stat label="Kassza összesen" value={ft(s.registerTotal)} hint="készpénz + kártya, váltóval" />
            <Stat label="Belső kassza kivét" value={ft(withdrawn)} hint="a széfből, a kasszától külön" />
            <Stat label="Ebből visszaváltási díj" value={ft(s.deposit)} hint="nem nyereség" />
            <Stat label="Nettó bevétel" value={ft(s.netRevenue)} hint="visszaváltási díj nélkül, a kasszával nem egyezik" />
            <Stat label="Nyereség" value={ft(s.profit)} hint={`költség: ${ft(s.cost)}`} />
            <Stat label="Belső fogyasztás" value={`${s.internalItems} db`} hint={`értéke: ${ft(s.internalValue)}${s.internalOutsideItems ? ` · ebből standon kívül ${s.internalOutsideItems} db` : ""}`} />
            <Stat label="Belső fogy. költsége" value={ft(s.internalCost)} />
            <Stat label="Nyereség belső fogy. után" value={ft(s.profitAfterInternal)} />
            <Stat label="Leltárkülönbség" value={`${s.variance} db`} hint={ft(s.varianceValue)} />
          </StatGrid>

          <SectionCard title="Termékek" flush>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Termék</TableHead>
                  <TableHead>Nyitó</TableHead>
                  <TableHead>Bevét.</TableHead>
                  <TableHead>Eladott</TableHead>
                  <TableHead>Kp. / kártya</TableHead>
                  <TableHead>Belső</TableHead>
                  <TableHead>Záró</TableHead>
                  <TableHead>Bevétel</TableHead>
                  <TableHead>Visszav. érték</TableHead>
                  <TableHead>Nyereség</TableHead>
                  <TableHead>Belső értéke</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.byProduct.map((p) => (
                  <TableRow key={p.productId} className="tabular-nums">
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.opening}</TableCell>
                    <TableCell>{p.restocked}</TableCell>
                    <TableCell>{p.sold}</TableCell>
                    <TableCell>
                      {p.soldCash} / {p.soldCard}
                    </TableCell>
                    <TableCell>
                      {p.internal}
                      {p.internalOutside ? ` (${p.internalOutside} kívül)` : ""}
                    </TableCell>
                    <TableCell>{p.closing}</TableCell>
                    <TableCell>{ft(p.revenue)}</TableCell>
                    <TableCell>{ft(p.deposit)}</TableCell>
                    <TableCell>{ft(p.profit)}</TableCell>
                    <TableCell>{ft(p.internalValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Napok" flush>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nap</TableHead>
                  <TableHead>Bevétel</TableHead>
                  <TableHead>Készpénz</TableHead>
                  <TableHead>Kártya</TableHead>
                  <TableHead>Váltó</TableHead>
                  <TableHead>Kassza összesen</TableHead>
                  <TableHead>Nyereség</TableHead>
                  <TableHead>Belső fogy.</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.byDay.map((row, i) => {
                  const day = days[i]!;
                  return (
                    <TableRow key={row.date} className="tabular-nums">
                      <TableCell className="font-medium">
                        {row.date} {day.status === "open" ? <Badge variant="success">nyitva</Badge> : null} {row.manual ? <Badge variant="outline">utólag rögzítve</Badge> : null}
                      </TableCell>
                      <TableCell className="font-semibold">{ft(row.revenue)}</TableCell>
                      <TableCell>
                        {ft(row.cash)} {row.cashCounted ? <Badge variant="outline">megszámolt</Badge> : null}
                      </TableCell>
                      <TableCell>{ft(row.card)}</TableCell>
                      <TableCell>{ft(row.floatHuf)}</TableCell>
                      <TableCell className="font-medium">{ft(row.registerTotal)}</TableCell>
                      <TableCell>{ft(row.profit)}</TableCell>
                      <TableCell>
                        {row.internalItems} db ({ft(row.internalValue)})
                      </TableCell>
                      <TableCell className="text-right">
                        {day.status === "closed" ? <DayActions dayId={String(day._id)} defaultEmail={day.reportSentTo || settings.reportEmail} canReopen={String(day._id) === latestClosedId} /> : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </SectionCard>
        </>
      )}
    </>
  );
}
