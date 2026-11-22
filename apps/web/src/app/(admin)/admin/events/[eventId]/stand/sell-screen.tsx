"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, PackagePlus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, FormField, ResultNotice } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { cn } from "@/lib/utils";
import { LogDialog } from "./log-dialog";
import { addProductToDayAction, changeStandAction, closeDayAction, endSandboxAction, setFloatAction, type StandChange, type StandResult } from "./actions";
import type { StandDayDto, StandLineDto } from "./dto";

type Mode = "cash" | "card" | "internal" | "restock" | "adjust";

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "cash", label: "Készpénz" },
  { key: "card", label: "Kártya" },
  { key: "internal", label: "Belső fogyasztás" },
  { key: "restock", label: "Bevételezés" },
  { key: "adjust", label: "Készletcsökkentés" },
];

const ft = (n: number) => `${n.toLocaleString("hu-HU")} Ft`;

/** What the confirm dialog is for. Undo kinds subtract. */
type TxKind = "sell" | "undo-sell" | "internal" | "undo-internal" | "undo-restock" | "adjust" | "undo-adjust";
interface Tx {
  kind: TxKind;
  line: StandLineDto;
}

const QUICK_QUANTITIES = [1, 2, 3, 4, 5, 6, 10];

/**
 * The stand during the day, laid out for a tablet: compact product rows so
 * a whole menu is visible at once, the totals in the bar above them. A tap
 * on a product (or its "−") opens a confirmation with a quantity, so
 * nothing is recorded by accident; the "+" box restocks (6 / 10 / 12 / 20
 * or any number).
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
  const [tx, setTx] = useState<Tx | null>(null);
  const [restocking, setRestocking] = useState<StandLineDto | null>(null);
  const [closing, setClosing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [floating, setFloating] = useState(false);
  const [pending, start] = useTransition();

  function apply(productId: string, change: StandChange, quantity: number) {
    setError(null);
    start(async () => {
      const result = await changeStandAction(day.id, productId, change, quantity);
      if (result.ok && result.day) setDay(result.day);
      else setError(result.message ?? "Failed.");
    });
  }

  function open(line: StandLineDto, subtract: boolean) {
    if (mode === "restock") {
      if (subtract) setTx({ kind: "undo-restock", line });
      else setRestocking(line);
    } else if (mode === "adjust") setTx({ kind: subtract ? "undo-adjust" : "adjust", line });
    else if (mode === "internal") setTx({ kind: subtract ? "undo-internal" : "internal", line });
    else setTx({ kind: subtract ? "undo-sell" : "sell", line });
  }

  const totals = day.lines.reduce(
    (t, l) => ({
      cash: t.cash + l.soldCash * l.priceHuf,
      card: t.card + l.soldCard * l.priceHuf,
      deposit: t.deposit + (l.soldCash + l.soldCard) * l.depositHuf,
      items: t.items + l.soldCash + l.soldCard,
      internal: t.internal + l.internal + l.internalOutside,
      internalValue: t.internalValue + (l.internal + l.internalOutside) * l.priceHuf,
      adjusted: t.adjusted + l.adjusted,
    }),
    { cash: 0, card: 0, deposit: 0, items: 0, internal: 0, internalValue: 0, adjusted: 0 },
  );
  const countOf = (l: StandLineDto) => (mode === "cash" ? l.soldCash : mode === "card" ? l.soldCard : mode === "internal" ? l.internal + l.internalOutside : mode === "adjust" ? l.adjusted : l.restocked);
  const countLabel = mode === "internal" ? "belső" : mode === "restock" ? "bevét." : mode === "adjust" ? "korr." : "eladva";

  return (
    <div className="grid gap-3">
      <div className="bg-background sticky top-14 z-10 grid gap-2 border-b py-2">
        <div className="flex flex-wrap items-center gap-2">
          {MODES.map((m) => (
            <Button key={m.key} size="lg" variant={mode === m.key ? "default" : "outline"} onClick={() => setMode(m.key)}>
              {m.label}
            </Button>
          ))}
          {day.devices ? <Badge variant="outline">Nyomtató + kártyaolvasó</Badge> : null}
          {day.sandbox ? <Badge variant="warning">Gyakorló mód</Badge> : null}
          <Button variant="outline" size="lg" onClick={() => setLogging(true)}>
            Napló
          </Button>
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
        <p className="text-muted-foreground flex flex-wrap items-baseline gap-x-4 text-sm tabular-nums">
          <span>
            Kasszában (készpénz, váltóval) <strong className="text-foreground text-base">{ft(day.floatHuf + totals.cash)}</strong>
          </span>
          <span>
            Kártya <strong className="text-foreground">{ft(totals.card)}</strong>
          </span>
          <span>
            Kassza összesen <strong className="text-foreground">{ft(day.floatHuf + totals.cash + totals.card)}</strong>
          </span>
          <span>
            Napi bevétel {ft(totals.cash + totals.card)} ({totals.items} db) · ebből visszaváltási díj {ft(totals.deposit)}
          </span>
          <span>
            Belső fogyasztás {totals.internal} db ({ft(totals.internalValue)})
          </span>
          {totals.adjusted > 0 ? <span>Készletcsökkentés {totals.adjusted} db</span> : null}
          {/* Quiet on purpose: most days give the float when opening; this is for adding or fixing it later. */}
          <span className="text-xs">
            váltó {ft(day.floatHuf)}{" "}
            <button type="button" className="hover:text-foreground underline underline-offset-2" onClick={() => setFloating(true)}>
              {day.floatHuf ? "módosít" : "megad"}
            </button>
          </span>
        </p>
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

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-4">
        {day.lines.map((line) => (
          <div key={line.productId} className={cn("bg-card flex min-h-16 items-stretch overflow-hidden rounded-lg border", pending && "opacity-80", (mode === "internal" || mode === "adjust") && "border-warning")}>
            <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-none p-2 text-left whitespace-normal" onClick={() => open(line, false)}>
              {line.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={line.image} alt="" className="size-12 shrink-0 rounded-md object-cover" />
              ) : null}
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="line-clamp-2 leading-tight font-semibold">{line.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {ft(line.priceHuf)}
                  {line.depositHuf ? ` · ${line.depositHuf} Ft visszav.` : ""}
                </span>
              </span>
              <span className="grid shrink-0 justify-items-end">
                <span className={cn("text-xl leading-none font-semibold tabular-nums", line.stock <= 0 && "text-destructive")}>{line.stock}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {countOf(line)} {countLabel}
                </span>
              </span>
            </Button>
            <div className="flex flex-col border-l">
              <Button variant="ghost" size="icon" className="h-auto flex-1 rounded-none" aria-label={`${line.name}: bevételezés`} onClick={() => setRestocking(line)}>
                <PackagePlus />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-auto flex-1 rounded-none border-t"
                aria-label={`${line.name}: storno`}
                disabled={countOf(line) === 0}
                onClick={() => open(line, true)}
              >
                <Minus />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <TxDialog
        key={tx ? `${tx.kind}:${tx.line.productId}` : "none"}
        tx={tx}
        defaultMethod={mode === "card" ? "card" : "cash"}
        onClose={() => setTx(null)}
        onConfirm={(t, quantity, options) => {
          const sign = t.kind.startsWith("undo") ? -1 : 1;
          const change: StandChange =
            t.kind === "sell" || t.kind === "undo-sell"
              ? { kind: "sell", method: options.method }
              : t.kind === "undo-restock"
                ? { kind: "restock" }
                : t.kind === "adjust" || t.kind === "undo-adjust"
                  ? { kind: "adjust", reason: options.reason }
                  : { kind: "internal", outside: options.outside };
          apply(t.line.productId, change, sign * quantity);
          setTx(null);
        }}
      />
      <RestockDialog line={restocking} packs={packs} onClose={() => setRestocking(null)} onAdd={(line, qty) => apply(line.productId, { kind: "restock" }, qty)} />
      {floating ? <FloatDialog day={day} onClose={() => setFloating(false)} onDay={setDay} /> : null}
      {logging ? <LogDialog dayId={day.id} canStorno onClose={() => setLogging(false)} onDay={setDay} /> : null}
      {/* Mounted fresh on every open, so it always starts from the day as it is now. */}
      {closing ? <CloseDialog onClose={() => setClosing(false)} day={day} defaultEmail={defaultEmail} /> : null}
    </div>
  );
}

const TITLES: Record<TxKind, string> = {
  sell: "Eladás",
  "undo-sell": "Storno – eladás",
  internal: "Belső fogyasztás",
  "undo-internal": "Storno – belső fogyasztás",
  "undo-restock": "Storno – bevételezés",
  adjust: "Készletcsökkentés",
  "undo-adjust": "Készletcsökkentés visszavonása",
};

/** Confirmation with a quantity: used for selling, internal use and their undo. */
function TxDialog({
  tx,
  defaultMethod,
  onClose,
  onConfirm,
}: {
  tx: Tx | null;
  defaultMethod: "cash" | "card";
  onClose: () => void;
  onConfirm: (tx: Tx, quantity: number, options: { method: "cash" | "card"; outside: boolean; reason: string }) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState(defaultMethod);
  const [outside, setOutside] = useState(false);
  const [reason, setReason] = useState("");
  if (!tx) return null;

  const { kind, line } = tx;
  const undo = kind.startsWith("undo");
  const isSale = kind === "sell" || kind === "undo-sell";
  const isRestock = kind === "undo-restock";
  const isAdjust = kind === "adjust" || kind === "undo-adjust";
  // A storno can't take back more than was recorded.
  const max = !undo ? 9999 : isRestock ? line.restocked : isAdjust ? line.adjusted : isSale ? (method === "card" ? line.soldCard : line.soldCash) : outside ? line.internalOutside : line.internal;
  const clamp = (n: number) => Math.min(Math.max(1, Math.floor(n) || 1), Math.max(1, max));
  const q = clamp(quantity);
  const overStock = !undo && (isSale || isAdjust || !outside) && q > line.stock;
  const confirmLabel = isSale ? `${undo ? "Storno" : "Eladás"} – ${ft(q * line.priceHuf)}` : isAdjust ? (undo ? "Visszavonás" : `−${q} db levonása`) : undo ? "Storno" : "Rögzítés";
  const confirm = () => onConfirm(tx, q, { method, outside, reason });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {line.name} – {TITLES[kind]}
          </DialogTitle>
          <DialogDescription>
            Készleten: {line.stock} db · {ft(line.priceHuf)}/db
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {isSale ? (
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" variant={method === "cash" ? "default" : "outline"} onClick={() => setMethod("cash")}>
                Készpénz
              </Button>
              <Button size="lg" variant={method === "card" ? "default" : "outline"} onClick={() => setMethod("card")}>
                Kártya
              </Button>
            </div>
          ) : isRestock ? null : isAdjust ? (
            undo ? null : (
              <FormField label="Miért (nem kötelező)" hint="Levonódik a készletből eladás és storno nélkül: törés, selejt, készletjavítás. A napi összesítőben a korrekciók között jelenik meg.">
                <Input value={reason} maxLength={200} placeholder="pl. törött üveg" onChange={(e) => setReason(e.target.value)} />
              </FormField>
            )
          ) : (
            <div className="grid gap-1.5">
              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" variant={!outside ? "default" : "outline"} onClick={() => setOutside(false)}>
                  Standból
                </Button>
                <Button size="lg" variant={outside ? "default" : "outline"} onClick={() => setOutside(true)}>
                  Standon kívül
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">{outside ? "Belső fogyasztásként számít, de nem vonódik le a stand készletéből." : "Levonódik a stand készletéből."}</p>
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            <Button size="icon-lg" variant="outline" aria-label="Kevesebb" disabled={q <= 1} onClick={() => setQuantity(clamp(q - 1))}>
              <Minus />
            </Button>
            <Input
              className="h-14 w-28 text-center text-3xl font-semibold tabular-nums"
              type="number"
              inputMode="numeric"
              aria-label="Mennyiség"
              value={q}
              onChange={(e) => setQuantity(clamp(Number(e.target.value)))}
              onKeyDown={(e) => e.key === "Enter" && confirm()}
            />
            <Button size="icon-lg" variant="outline" aria-label="Több" disabled={q >= max} onClick={() => setQuantity(clamp(q + 1))}>
              <Plus />
            </Button>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {QUICK_QUANTITIES.filter((n) => n <= max).map((n) => (
              <Button key={n} variant={q === n ? "default" : "outline"} onClick={() => setQuantity(n)}>
                {n}
              </Button>
            ))}
          </div>
          {undo && max === 0 ? <p className="text-muted-foreground text-center text-sm">Ebből most nincs mit stornózni.</p> : null}
          {overStock ? <p className="text-destructive text-center text-sm">Több, mint a készlet ({line.stock} db).</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Mégse
          </Button>
          <Button size="lg" disabled={undo && max === 0} onClick={confirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FloatDialog({ day, onClose, onDay }: { day: StandDayDto; onClose: () => void; onDay: (day: StandDayDto) => void }) {
  const [value, setValue] = useState(day.floatHuf ? String(day.floatHuf) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await setFloatAction(day.id, Number(value) || 0);
      if (r.ok && r.day) {
        onDay(r.day);
        onClose();
      } else setError(r.message ?? "Failed.");
    });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nyitó váltó</DialogTitle>
          <DialogDescription>A nyitáskor a kasszába betett készpénz. Nem bevétel; a kassza-riportban a készpénzhez adódik.</DialogDescription>
        </DialogHeader>
        <FormField label="Nyitó váltó (Ft)" error={error}>
          <Input autoFocus type="number" inputMode="numeric" min={0} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        </FormField>
        <DialogFooter>
          <Button disabled={pending} onClick={save}>
            Mentés
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function CloseDialog({ onClose, day, defaultEmail }: { onClose: () => void; day: StandDayDto; defaultEmail: string }) {
  const router = useRouter();
  const [counted, setCounted] = useState<Record<string, string>>({});
  // Empty = keep what was recorded during the day (shown as the placeholder), so there is nothing to type for 0.
  const [inside, setInside] = useState<Record<string, string>>({});
  const [outside, setOutside] = useState<Record<string, string>>({});
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [floatValue, setFloatValue] = useState("");
  const [note, setNote] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [result, setResult] = useState<StandResult | null>(null);
  const [pending, start] = useTransition();
  const totals = day.lines.reduce(
    (t, l) => ({ cash: t.cash + l.soldCash * l.priceHuf, card: t.card + l.soldCard * l.priceHuf, deposit: t.deposit + (l.soldCash + l.soldCard) * l.depositHuf }),
    { cash: 0, card: 0, deposit: 0 },
  );
  const entered = (v: string | undefined) => v !== undefined && v.trim() !== "";
  // Sales weren't tapped one by one (only adjustments and the closing count were kept): the takings are typed in.
  const [byTotals, setByTotals] = useState(totals.cash + totals.card === 0);
  const cashN = entered(cash) ? Number(cash) : null;
  const cardN = entered(card) ? Number(card) : null;
  const floatN = entered(floatValue) ? Number(floatValue) : day.floatHuf;
  const tapped = totals.cash + totals.card;
  const cashTooHigh = !byTotals && cashN !== null && cashN > day.floatHuf + tapped;
  const cashBelowFloat = byTotals && cashN !== null && cashN < floatN;
  const totalsMissing = byTotals && (cashN === null || cardN === null);
  const typedCash = byTotals && cashN !== null ? Math.max(cashN - floatN, 0) : 0;
  const typedCard = byTotals && cardN !== null ? cardN : 0;
  const revenue = byTotals ? typedCash + typedCard : tapped;
  const registerCash = byTotals ? (cashN ?? floatN) : day.floatHuf + totals.cash;
  const registerCard = byTotals ? typedCard : totals.card;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nap zárása – {day.date}</DialogTitle>
          <DialogDescription>
            Számold meg a készletet; ha üresen hagyod, a számolt érték marad. A belső fogyasztás üresen hagyva az marad, amit napközben rögzítettél.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/50 grid gap-2 rounded-lg p-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div className="grid">
              <span className="text-muted-foreground text-xs font-medium">Napi bevétel</span>
              <strong className="text-3xl font-semibold tabular-nums">{ft(revenue)}</strong>
            </div>
            <div className="grid">
              <span className="text-muted-foreground text-xs font-medium">Kasszában várható készpénz (váltóval)</span>
              <strong className="text-xl font-semibold tabular-nums">{ft(registerCash)}</strong>
            </div>
            <div className="grid">
              <span className="text-muted-foreground text-xs font-medium">Kártya</span>
              <strong className="text-xl font-semibold tabular-nums">{ft(registerCard)}</strong>
            </div>
            <div className="grid">
              <span className="text-muted-foreground text-xs font-medium">Kassza összesen</span>
              <strong className="text-xl font-semibold tabular-nums">{ft(registerCash + registerCard)}</strong>
            </div>
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {byTotals
              ? `A napi bevétel a megadott készpénz (váltó nélkül) és a kártya összege; a nyitó váltó (${ft(floatN)}) a kasszához tartozik, nem bevétel.`
              : `A visszaváltási díjat tartalmazza (ebből ${ft(totals.deposit)}), a nyitó váltó (${ft(day.floatHuf)}) a kasszához tartozik, nem bevétel. A visszaváltási díj nélküli nettó: ${ft(revenue - totals.deposit)}.`}
          </span>
        </div>
        <CheckboxField
          label="Nem ütöttem be minden eladást: a napi összesítőt kézzel adom meg"
          hint="Csak a készletcsökkentéseket és a záró leltárt vezetted? Add meg a kasszában lévő készpénzt (váltóval) és a bankkártyás összeget. A jelentés ekkor a nyitó és záró készletet a korrekciókkal, a bevételt és a megjegyzést tartalmazza."
          checked={byTotals}
          onCheckedChange={setByTotals}
        />
        {byTotals ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField
              label="Készpénz a kasszában – kp (Ft)"
              hint="A megszámolt teljes készpénz, a nyitó váltóval együtt."
              error={cashBelowFloat ? `Kevesebb, mint a váltó (${ft(floatN)}).` : undefined}
            >
              <Input type="number" inputMode="numeric" min={0} value={cash} onChange={(e) => setCash(e.target.value)} />
            </FormField>
            <FormField label="Bankkártya – bk (Ft)" hint="A kártyás bevétel összesen.">
              <Input type="number" inputMode="numeric" min={0} value={card} onChange={(e) => setCard(e.target.value)} />
            </FormField>
            <FormField label="Nyitó váltó (Ft)" hint="Csak ha módosult.">
              <Input type="number" inputMode="numeric" min={0} placeholder={String(day.floatHuf)} value={floatValue} onChange={(e) => setFloatValue(e.target.value)} />
            </FormField>
          </div>
        ) : (
          <FormField
            label="Megszámolt készpénz a kasszában (Ft)"
            hint="Nem kötelező. Ha nem minden eladást ütöttél be a jó fizetési móddal, add meg a kasszában lévő teljes készpénzt (váltóval együtt): a kártyás rész a napi bevétel többi része lesz."
            error={cashTooHigh ? `Több, mint a váltó és a beütött eladások együtt (${ft(day.floatHuf + tapped)}). Ha nem ütöttél be mindent, add meg a napi összesítőt kézzel.` : undefined}
          >
            <Input type="number" inputMode="numeric" min={0} value={cash} onChange={(e) => setCash(e.target.value)} />
          </FormField>
        )}

        <div className="grid gap-3">
          {day.lines.map((l) => {
            const calculated = l.stock + l.internal - (entered(inside[l.productId]) ? Number(inside[l.productId]) : l.internal);
            return (
              <div key={l.productId} className="grid grid-cols-3 items-end gap-2">
                <FormField label={`${l.name} – záró`} hint={`Számolt: ${calculated} db`}>
                  <Input type="number" inputMode="numeric" min={0} placeholder={String(calculated)} value={counted[l.productId] ?? ""} onChange={(e) => setCounted({ ...counted, [l.productId]: e.target.value })} />
                </FormField>
                {/* Optional: Tab skips them, so the closing counts can be typed straight down the list. */}
                <FormField label="Belső standból">
                  <Input tabIndex={-1} type="number" inputMode="numeric" min={0} placeholder={String(l.internal)} value={inside[l.productId] ?? ""} onChange={(e) => setInside({ ...inside, [l.productId]: e.target.value })} />
                </FormField>
                <FormField label="Belső kívül">
                  <Input tabIndex={-1} type="number" inputMode="numeric" min={0} placeholder={String(l.internalOutside)} value={outside[l.productId] ?? ""} onChange={(e) => setOutside({ ...outside, [l.productId]: e.target.value })} />
                </FormField>
              </div>
            );
          })}
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
            disabled={pending || result?.ok === true || cashTooHigh || cashBelowFloat || totalsMissing}
            onClick={() =>
              start(async () => {
                const counts = Object.fromEntries(day.lines.filter((l) => entered(counted[l.productId])).map((l) => [l.productId, Number(counted[l.productId])]));
                const internal = Object.fromEntries(
                  day.lines
                    .filter((l) => entered(inside[l.productId]) || entered(outside[l.productId]))
                    .map((l) => [l.productId, { inside: entered(inside[l.productId]) ? Number(inside[l.productId]) : undefined, outside: entered(outside[l.productId]) ? Number(outside[l.productId]) : undefined }]),
                );
                const r = await closeDayAction(day.id, counts, internal, cashN, note, email.trim(), byTotals ? cardN : null, byTotals && entered(floatValue) ? floatN : null);
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
