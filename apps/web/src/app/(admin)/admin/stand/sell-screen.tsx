"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, PackagePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, ResultNotice } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { Stat, StatGrid } from "@/components/stat";
import { cn } from "@/lib/utils";
import { addProductToDayAction, changeStandAction, closeDayAction, endSandboxAction, type StandChange, type StandResult } from "./actions";
import type { StandDayDto, StandLineDto } from "./dto";

type Mode = "cash" | "card" | "internal" | "restock";

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "cash", label: "Készpénz" },
  { key: "card", label: "Kártya" },
  { key: "internal", label: "Belső fogyasztás" },
  { key: "restock", label: "Bevételezés" },
];

const ft = (n: number) => `${n.toLocaleString("hu-HU")} Ft`;

/**
 * The stand during the day. One tap on a product sells one in the chosen
 * payment mode (or records internal use); the "+" on a tile, or a tap in
 * restock mode, opens the quick-add (6 / 10 / 12 / 20 or any number).
 */
export function SellScreen({
  eventId,
  initial,
  packs,
  defaultEmail,
  missing,
}: {
  eventId: string;
  initial: StandDayDto;
  packs: number[];
  defaultEmail: string;
  missing: Array<{ id: string; name: string }>;
}) {
  void eventId;
  const router = useRouter();
  const [day, setDay] = useState(initial);
  const [mode, setMode] = useState<Mode>("cash");
  const [error, setError] = useState<string | null>(null);
  const [restocking, setRestocking] = useState<StandLineDto | null>(null);
  const [closing, setClosing] = useState(false);
  const [pending, start] = useTransition();

  function apply(productId: string, change: StandChange, quantity: number) {
    setError(null);
    start(async () => {
      const result = await changeStandAction(day.id, productId, change, quantity);
      if (result.ok && result.day) setDay(result.day);
      else setError(result.message ?? "Failed.");
    });
  }

  const changeFor = (m: Mode): StandChange => (m === "cash" || m === "card" ? { kind: "sell", method: m } : m === "internal" ? { kind: "internal" } : { kind: "restock" });

  function tap(line: StandLineDto, quantity: number) {
    if (mode === "restock") {
      setRestocking(line);
      return;
    }
    apply(line.productId, changeFor(mode), quantity);
  }

  const totals = day.lines.reduce(
    (t, l) => ({
      cash: t.cash + l.soldCash * l.priceHuf,
      card: t.card + l.soldCard * l.priceHuf,
      deposit: t.deposit + (l.soldCash + l.soldCard) * l.depositHuf,
      items: t.items + l.soldCash + l.soldCard,
      internal: t.internal + l.internal,
      internalValue: t.internalValue + l.internal * l.priceHuf,
    }),
    { cash: 0, card: 0, deposit: 0, items: 0, internal: 0, internalValue: 0 },
  );
  const countOf = (l: StandLineDto) => (mode === "cash" ? l.soldCash : mode === "card" ? l.soldCard : mode === "internal" ? l.internal : l.restocked);

  return (
    <div className="grid gap-4">
      <div className="bg-background sticky top-0 z-10 flex flex-wrap items-center gap-2 py-2">
        {MODES.map((m) => (
          <Button key={m.key} size="lg" variant={mode === m.key ? "default" : "outline"} onClick={() => setMode(m.key)}>
            {m.label}
          </Button>
        ))}
        {day.devices ? <Badge variant="outline">Nyomtató + kártyaolvasó</Badge> : null}
        {day.sandbox ? (
          <Button
            className="ml-auto"
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await endSandboxAction(day.id);
                if (r.ok) router.refresh();
                else setError(r.message ?? "Failed.");
              })
            }
          >
            Gyakorlás vége
          </Button>
        ) : (
          <Button className="ml-auto" variant="outline" size="lg" onClick={() => setClosing(true)}>
            Nap zárása
          </Button>
        )}
      </div>

      {day.sandbox ? <Notice tone="warning">Gyakorló mód: semmi sem kerül a statisztikába vagy a készletbe, a végén az egész törlődik.</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {missing.length > 0 ? (
        <Notice tone="info">
          Új termék, még nincs a mai napon:{" "}
          {missing.map((p) => (
            <Button
              key={p.id}
              variant="link"
              className="h-auto p-0 pr-3"
              onClick={() =>
                start(async () => {
                  const r = await addProductToDayAction(day.id, p.id, 0);
                  if (r.ok && r.day) setDay(r.day);
                })
              }
            >
              {p.name} hozzáadása
            </Button>
          ))}
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {day.lines.map((line) => (
          <div
            key={line.productId}
            className={cn("bg-card relative flex flex-col overflow-hidden rounded-lg border", pending && "opacity-80", mode === "internal" && "border-warning")}
          >
            <Button variant="ghost" className="h-auto flex-1 flex-col items-stretch gap-1 rounded-none p-0 text-left whitespace-normal" onClick={() => tap(line, 1)}>
              {line.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={line.image} alt="" className="aspect-[4/3] w-full object-cover" />
              ) : null}
              <span className="grid gap-0.5 p-3">
                <span className="font-semibold">{line.name}</span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {ft(line.priceHuf)}
                  {line.depositHuf ? ` (ebből ${line.depositHuf} Ft visszaváltási érték)` : ""}
                </span>
                <span className="flex items-baseline justify-between pt-1">
                  <span className={cn("text-2xl font-semibold tabular-nums", line.stock <= 0 && "text-destructive")}>{line.stock} db</span>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {mode === "restock" ? "+" : ""}
                    {countOf(line)} {mode === "internal" ? "belső" : mode === "restock" ? "bevét." : "eladva"}
                  </span>
                </span>
              </span>
            </Button>
            <div className="flex border-t">
              <Button variant="ghost" size="sm" className="flex-1 rounded-none" aria-label={`${line.name}: egy vissza`} disabled={countOf(line) === 0 || mode === "restock"} onClick={() => tap(line, -1)}>
                <Minus />
              </Button>
              <Button variant="ghost" size="sm" className="flex-1 rounded-none border-l" aria-label={`${line.name}: bevételezés`} onClick={() => setRestocking(line)}>
                <PackagePlus /> Bevét.
              </Button>
            </div>
          </div>
        ))}
      </div>

      <StatGrid>
        <Stat label="Készpénz" value={ft(totals.cash)} />
        <Stat label="Kártya" value={ft(totals.card)} />
        <Stat label="Összesen" value={ft(totals.cash + totals.card)} hint={`${totals.items} db`} />
        <Stat label="Visszaváltási érték" value={ft(totals.deposit)} hint="nem nyereség" />
        <Stat label="Belső fogyasztás" value={`${totals.internal} db`} hint={ft(totals.internalValue)} />
      </StatGrid>

      <RestockDialog line={restocking} packs={packs} onClose={() => setRestocking(null)} onAdd={(line, qty) => apply(line.productId, { kind: "restock" }, qty)} />
      <CloseDialog open={closing} onOpenChange={setClosing} day={day} defaultEmail={defaultEmail} />
    </div>
  );
}

function RestockDialog({ line, packs, onClose, onAdd }: { line: StandLineDto | null; packs: number[]; onClose: () => void; onAdd: (line: StandLineDto, qty: number) => void }) {
  const [custom, setCustom] = useState("");
  const add = (qty: number) => {
    if (!line || !Number.isInteger(qty) || qty === 0) return;
    onAdd(line, qty);
    setCustom("");
    onClose();
  };
  return (
    <Dialog open={line !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{line?.name} – bevételezés</DialogTitle>
          <DialogDescription>Egy érintés a kiválasztott mennyiséget a pultra teszi. Most: {line?.stock} db.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {packs.map((p) => (
            <Button key={p} size="lg" onClick={() => add(p)}>
              +{p}
            </Button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <FormField label="Egyéni mennyiség" className="flex-1" hint="Negatív szám javítás (pl. -3).">
            <Input type="number" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(Number(custom))} />
          </FormField>
          <Button variant="outline" disabled={!Number(custom)} onClick={() => add(Number(custom))}>
            Hozzáad
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({ open, onOpenChange, day, defaultEmail }: { open: boolean; onOpenChange: (open: boolean) => void; day: StandDayDto; defaultEmail: string }) {
  const router = useRouter();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [result, setResult] = useState<StandResult | null>(null);
  const [pending, start] = useTransition();
  const money = day.lines.reduce((t, l) => ({ cash: t.cash + l.soldCash * l.priceHuf, card: t.card + l.soldCard * l.priceHuf }), { cash: 0, card: 0 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nap zárása – {day.date}</DialogTitle>
          <DialogDescription>
            A fiókban várhatóan {ft(money.cash)} készpénz van, a kártyás bevétel {ft(money.card)}. Számold meg a készletet; ha üresen hagyod, a számolt érték marad.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {day.lines.map((l) => (
            <FormField key={l.productId} label={l.name} hint={`Számolt: ${l.stock} db`}>
              <Input type="number" inputMode="numeric" min={0} placeholder={String(l.stock)} value={counted[l.productId] ?? ""} onChange={(e) => setCounted({ ...counted, [l.productId]: e.target.value })} />
            </FormField>
          ))}
        </div>
        <FormField label="Jelentés e-mailben (Excellel)" hint="Üresen hagyva nem megy ki jelentés.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField label="Megjegyzés">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        <ResultNotice result={result} />
        <DialogFooter>
          <Button
            disabled={pending || result?.ok === true}
            onClick={() =>
              start(async () => {
                const entered = Object.fromEntries(Object.entries(counted).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]));
                const r = await closeDayAction(day.id, entered, note, email.trim());
                setResult(r);
                if (r.ok) router.refresh();
              })
            }
          >
            Nap lezárása
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
