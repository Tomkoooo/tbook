"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, PackagePlus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, ResultNotice } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { cn } from "@/lib/utils";
import { LogDialog } from "./log-dialog";
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

/** What the confirm dialog is for. Undo kinds subtract. */
type TxKind = "sell" | "undo-sell" | "internal" | "undo-internal" | "undo-restock";
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
    } else if (mode === "internal") setTx({ kind: subtract ? "undo-internal" : "internal", line });
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
    }),
    { cash: 0, card: 0, deposit: 0, items: 0, internal: 0, internalValue: 0 },
  );
  const countOf = (l: StandLineDto) => (mode === "cash" ? l.soldCash : mode === "card" ? l.soldCard : mode === "internal" ? l.internal + l.internalOutside : l.restocked);
  const countLabel = mode === "internal" ? "belső" : mode === "restock" ? "bevét." : "eladva";

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
            Kasszában (készpénz) <strong className="text-foreground text-base">{ft(totals.cash)}</strong>
          </span>
          <span>
            Kártya <strong className="text-foreground">{ft(totals.card)}</strong>
          </span>
          <span>
            Összesen <strong className="text-foreground">{ft(totals.cash + totals.card)}</strong> ({totals.items} db)
          </span>
          <span>ebből visszaváltási díj {ft(totals.deposit)}</span>
          <span>
            Belső fogyasztás {totals.internal} db ({ft(totals.internalValue)})
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
          <div key={line.productId} className={cn("bg-card flex min-h-16 items-stretch overflow-hidden rounded-lg border", pending && "opacity-80", mode === "internal" && "border-warning")}>
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
            t.kind === "sell" || t.kind === "undo-sell" ? { kind: "sell", method: options.method } : t.kind === "undo-restock" ? { kind: "restock" } : { kind: "internal", outside: options.outside };
          apply(t.line.productId, change, sign * quantity);
          setTx(null);
        }}
      />
      <RestockDialog line={restocking} packs={packs} onClose={() => setRestocking(null)} onAdd={(line, qty) => apply(line.productId, { kind: "restock" }, qty)} />
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
  onConfirm: (tx: Tx, quantity: number, options: { method: "cash" | "card"; outside: boolean }) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState(defaultMethod);
  const [outside, setOutside] = useState(false);
  if (!tx) return null;

  const { kind, line } = tx;
  const undo = kind.startsWith("undo");
  const isSale = kind === "sell" || kind === "undo-sell";
  const isRestock = kind === "undo-restock";
  // A storno can't take back more than was recorded.
  const max = !undo ? 9999 : isRestock ? line.restocked : isSale ? (method === "card" ? line.soldCard : line.soldCash) : outside ? line.internalOutside : line.internal;
  const clamp = (n: number) => Math.min(Math.max(1, Math.floor(n) || 1), Math.max(1, max));
  const q = clamp(quantity);
  const overStock = !undo && (isSale || !outside) && q > line.stock;
  const confirmLabel = isSale ? `${undo ? "Storno" : "Eladás"} – ${ft(q * line.priceHuf)}` : undo ? "Storno" : "Rögzítés";

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
          ) : isRestock ? null : (
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
              onKeyDown={(e) => e.key === "Enter" && onConfirm(tx, q, { method, outside })}
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
          <Button size="lg" disabled={undo && max === 0} onClick={() => onConfirm(tx, q, { method, outside })}>
            {confirmLabel}
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
  const [note, setNote] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [result, setResult] = useState<StandResult | null>(null);
  const [pending, start] = useTransition();
  const totals = day.lines.reduce(
    (t, l) => ({ cash: t.cash + l.soldCash * l.priceHuf, card: t.card + l.soldCard * l.priceHuf, deposit: t.deposit + (l.soldCash + l.soldCard) * l.depositHuf }),
    { cash: 0, card: 0, deposit: 0 },
  );
  const revenue = totals.cash + totals.card;
  const entered = (v: string | undefined) => v !== undefined && v.trim() !== "";
  const cashN = entered(cash) ? Number(cash) : null;
  const cashTooHigh = cashN !== null && cashN > revenue;

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
              <span className="text-muted-foreground text-xs font-medium">Kasszában várható készpénz</span>
              <strong className="text-3xl font-semibold tabular-nums">{ft(totals.cash)}</strong>
            </div>
            <div className="grid">
              <span className="text-muted-foreground text-xs font-medium">Kártya</span>
              <strong className="text-xl font-semibold tabular-nums">{ft(totals.card)}</strong>
            </div>
            <div className="grid">
              <span className="text-muted-foreground text-xs font-medium">Napi bevétel összesen</span>
              <strong className="text-xl font-semibold tabular-nums">{ft(revenue)}</strong>
            </div>
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            A visszaváltási díjat tartalmazza (ebből {ft(totals.deposit)}), így a kassza végösszegével egyezik. A visszaváltási díj nélküli nettó: {ft(revenue - totals.deposit)}.
          </span>
        </div>
        <FormField
          label="Megszámolt készpénz (Ft)"
          hint="Nem kötelező. Ha nem minden eladást ütöttél be a jó fizetési móddal, add meg a fiókban lévő készpénzt: a kártyás rész a napi bevétel többi része lesz."
          error={cashTooHigh ? `Több, mint a napi bevétel (${ft(revenue)}).` : undefined}
        >
          <Input type="number" inputMode="numeric" min={0} value={cash} onChange={(e) => setCash(e.target.value)} />
        </FormField>

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
            disabled={pending || result?.ok === true || cashTooHigh}
            onClick={() =>
              start(async () => {
                const counts = Object.fromEntries(day.lines.filter((l) => entered(counted[l.productId])).map((l) => [l.productId, Number(counted[l.productId])]));
                const internal = Object.fromEntries(
                  day.lines
                    .filter((l) => entered(inside[l.productId]) || entered(outside[l.productId]))
                    .map((l) => [l.productId, { inside: entered(inside[l.productId]) ? Number(inside[l.productId]) : undefined, outside: entered(outside[l.productId]) ? Number(outside[l.productId]) : undefined }]),
                );
                const r = await closeDayAction(day.id, counts, internal, cashN, note, email.trim());
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
