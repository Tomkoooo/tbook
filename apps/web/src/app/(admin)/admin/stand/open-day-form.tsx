"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxField, FormField, ResultNotice } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import { manualDayAction, openDayAction, type StandResult } from "./actions";

interface Item {
  productId: string;
  name: string;
  category: "drink" | "food";
  opening: number;
  fromPrevious: boolean;
}

/** Opening: counts start at last closing; change what differs, pick the mode, open. */
export function OpenDayForm({ eventId, date, previousDate, items, manage }: { eventId: string; date: string; previousDate: string | null; items: Item[]; manage: boolean }) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.productId, String(i.opening)])));
  const [devices, setDevices] = useState(false);
  const [result, setResult] = useState<StandResult | null>(null);
  const [pending, start] = useTransition();
  const numbers = () => Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v) || 0]));

  if (items.length === 0) return <Notice tone="warning">Add products first (Termékek tab).</Notice>;

  return (
    <div className="grid gap-4">
      <SectionCard
        title={`Nyitás – ${date}`}
        description={previousDate ? `A nyitó készlet a(z) ${previousDate} záró készlete. Írd át, ha eltér.` : "Még nincs előző nap: add meg a nyitó készletet."}
      >
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <FormField key={item.productId} label={item.name} hint={item.fromPrevious ? undefined : "Nincs előző záró készlet"}>
                <Input inputMode="numeric" min={0} type="number" value={counts[item.productId]} onChange={(e) => setCounts({ ...counts, [item.productId]: e.target.value })} />
              </FormField>
            ))}
          </div>
          <CheckboxField label="Nyomtató és kártyaolvasó kezelése" hint="Ki: csak készletkezelés. Be: az eladásokhoz nyomtatás és kártyaolvasó is tartozik." checked={devices} onCheckedChange={setDevices} />
          <ResultNotice result={result} />
          <div>
            <Button
              size="lg"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await openDayAction(eventId, devices, numbers());
                  setResult(r);
                  if (r.ok) router.refresh();
                })
              }
            >
              Nap megnyitása
            </Button>
          </div>
        </div>
      </SectionCard>
      {manage ? <ManualDay eventId={eventId} items={items} /> : null}
    </div>
  );
}

/** A day that wasn't kept in the app: give the closing stock and takings so tomorrow can open. */
function ManualDay({ eventId, items }: { eventId: string; items: Item[] }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [closing, setClosing] = useState<Record<string, string>>({});
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [result, setResult] = useState<StandResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <SectionCard title="Korábbi nap rögzítése" description="Záró készlet és készpénz/kártya bevétel megadása, hogy a következő napot erről lehessen nyitni.">
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Nap">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Készpénz bevétel (Ft)">
            <Input type="number" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} />
          </FormField>
          <FormField label="Kártyás bevétel (Ft)">
            <Input type="number" inputMode="numeric" value={card} onChange={(e) => setCard(e.target.value)} />
          </FormField>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <FormField key={item.productId} label={`${item.name} – záró`}>
              <Input type="number" inputMode="numeric" min={0} value={closing[item.productId] ?? ""} onChange={(e) => setClosing({ ...closing, [item.productId]: e.target.value })} />
            </FormField>
          ))}
        </div>
        <ResultNotice result={result} />
        <div>
          <Button
            variant="outline"
            disabled={pending || !date}
            onClick={() =>
              start(async () => {
                const r = await manualDayAction(eventId, date, Object.fromEntries(Object.entries(closing).map(([k, v]) => [k, Number(v) || 0])), Number(cash) || 0, Number(card) || 0, "");
                setResult(r);
                if (r.ok) router.refresh();
              })
            }
          >
            Nap rögzítése
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
