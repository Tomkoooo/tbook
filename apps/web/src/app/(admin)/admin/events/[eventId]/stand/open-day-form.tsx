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
export function OpenDayForm({ eventId, date, previousDate, previousFloat, items, manage, defaultEmail }: { eventId: string; date: string; previousDate: string | null; previousFloat: number; items: Item[]; manage: boolean; defaultEmail: string }) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.productId, String(i.opening)])));
  const [devices, setDevices] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const [float, setFloat] = useState(previousFloat ? String(previousFloat) : "");
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
          <FormField label="Nyitó váltó (Ft)" hint={previousFloat ? "Az előző nap váltója; írd át, ha más." : "A kasszába a nyitáskor betett készpénz. Nem bevétel. Üresen hagyható, később is megadható."}>
            <Input type="number" inputMode="numeric" min={0} className="max-w-48" value={float} onChange={(e) => setFloat(e.target.value)} />
          </FormField>
          <CheckboxField label="Nyomtató és kártyaolvasó kezelése" hint="Ki: csak készletkezelés. Be: az eladásokhoz nyomtatás és kártyaolvasó is tartozik." checked={devices} onCheckedChange={setDevices} />
          <CheckboxField label="Gyakorló mód" hint="Kipróbálás éles nyitás nélkül: a meglévő termékekkel, a megadott mennyiségekkel. Nem kerül a statisztikába és a készletbe, a végén törlődik." checked={sandbox} onCheckedChange={setSandbox} />
          <ResultNotice result={result} />
          <div>
            <Button
              size="lg"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await openDayAction(eventId, devices, numbers(), sandbox, Number(float) || 0);
                  setResult(r);
                  if (r.ok) router.refresh();
                })
              }
            >
              {sandbox ? "Gyakorlás indítása" : "Nap megnyitása"}
            </Button>
          </div>
        </div>
      </SectionCard>
      {manage ? <ManualDay eventId={eventId} items={items} defaultEmail={defaultEmail} /> : null}
    </div>
  );
}

/** A day that wasn't kept in the app: give the closing stock, internal use and takings so tomorrow can open (and the report can go out). */
function ManualDay({ eventId, items, defaultEmail }: { eventId: string; items: Item[]; defaultEmail: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [closing, setClosing] = useState<Record<string, string>>({});
  const [inside, setInside] = useState<Record<string, string>>({});
  const [outside, setOutside] = useState<Record<string, string>>({});
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [result, setResult] = useState<StandResult | null>(null);
  const [pending, start] = useTransition();
  const num = (v: string | undefined) => Number(v) || 0;
  // Left empty = not given (0): the internal fields are optional, and Tab skips them to the next product's closing count.
  const optional = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : Number(v));
  return (
    <SectionCard title="Korábbi nap rögzítése" description="Záró készlet, belső fogyasztás és készpénz/kártya bevétel megadása, hogy a következő napot erről lehessen nyitni. A jelentés e-mailben is kiküldhető.">
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
        <div className="grid gap-3">
          {items.map((item) => (
            <div key={item.productId} className="grid grid-cols-3 items-end gap-2">
              <FormField label={`${item.name} – záró`}>
                <Input type="number" inputMode="numeric" min={0} value={closing[item.productId] ?? ""} onChange={(e) => setClosing({ ...closing, [item.productId]: e.target.value })} />
              </FormField>
              <FormField label="Belső standból" hint="A stand készletéből">
                <Input tabIndex={-1} type="number" inputMode="numeric" min={0} value={inside[item.productId] ?? ""} onChange={(e) => setInside({ ...inside, [item.productId]: e.target.value })} />
              </FormField>
              <FormField label="Belső kívül" hint="Nem a stand készletéből">
                <Input tabIndex={-1} type="number" inputMode="numeric" min={0} value={outside[item.productId] ?? ""} onChange={(e) => setOutside({ ...outside, [item.productId]: e.target.value })} />
              </FormField>
            </div>
          ))}
        </div>
        <FormField label="Jelentés e-mailben (Excellel)" hint="Üresen hagyva nem megy ki jelentés.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <ResultNotice result={result} />
        <div>
          <Button
            variant="outline"
            disabled={pending || !date}
            onClick={() =>
              start(async () => {
                const r = await manualDayAction(
                  eventId,
                  date,
                  Object.fromEntries(items.map((i) => [i.productId, num(closing[i.productId])])),
                  Object.fromEntries(items.map((i) => [i.productId, { inside: optional(inside[i.productId]), outside: optional(outside[i.productId]) }])),
                  num(cash),
                  num(card),
                  "",
                  email.trim(),
                );
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
