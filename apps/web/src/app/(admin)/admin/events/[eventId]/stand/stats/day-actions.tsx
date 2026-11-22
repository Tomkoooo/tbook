"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField, ResultNotice } from "@/components/form-bits";
import { eventPath } from "@/lib/event-routes";
import { reopenDayAction, resendReportAction, setDayTakingsAction, type StandResult } from "../actions";

const ft = (n: number) => `${Math.round(n).toLocaleString("hu-HU")} Ft`;

export interface DayTakingsDefaults {
  /** Cash takings without the float. */
  cashHuf: number;
  cardHuf: number;
  floatHuf: number;
  /** Takings were already entered as totals. */
  entered: boolean;
}

/** Per closed day: email the report again, fix the takings, or reopen the latest day to fix the stock. */
export function DayActions({
  eventId,
  dayId,
  defaultEmail,
  canReopen,
  takings,
}: {
  eventId: string;
  dayId: string;
  defaultEmail: string;
  canReopen: boolean;
  /** Present when the takings can be entered/corrected (not for days recorded by hand). */
  takings?: DayTakingsDefaults;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [message, setMessage] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input className="h-8 w-48" type="email" aria-label="Report recipient" placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !email}
        onClick={() =>
          start(async () => {
            setMessage((await resendReportAction(dayId, email)).message ?? null);
          })
        }
      >
        Jelentés küldése
      </Button>
      {takings ? (
        <Button size="sm" variant="outline" onClick={() => setFixing(true)}>
          Bevétel megadása
        </Button>
      ) : null}
      {canReopen ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await reopenDayAction(dayId);
              setMessage(r.message ?? null);
              if (r.ok) router.push(eventPath(eventId, "stand"));
            })
          }
        >
          Újranyitás
        </Button>
      ) : null}
      {message ? <span className="text-muted-foreground text-xs">{message}</span> : null}
      {fixing && takings ? <TakingsDialog dayId={dayId} defaults={takings} onClose={() => setFixing(false)} /> : null}
    </div>
  );
}

/** Enter or correct the takings of a closed day. The report then lists inventory with adjustments, the takings and the note. */
function TakingsDialog({ dayId, defaults, onClose }: { dayId: string; defaults: DayTakingsDefaults; onClose: () => void }) {
  const router = useRouter();
  const [cash, setCash] = useState(String(defaults.cashHuf));
  const [card, setCard] = useState(String(defaults.cardHuf));
  const [float, setFloat] = useState(String(defaults.floatHuf));
  const [result, setResult] = useState<StandResult | null>(null);
  const [pending, start] = useTransition();
  const cashN = Number(cash) || 0;
  const cardN = Number(card) || 0;
  const floatN = Number(float) || 0;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Napi bevétel megadása</DialogTitle>
          <DialogDescription>
            A záró készlet marad. A jelentés a nyitó és záró készletet a korrekciókkal, a bevételt és a megjegyzést tartalmazza. A következő nap nyitása nem változik.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Készpénz – kp (Ft)" hint="A váltó nélkül.">
            <Input type="number" inputMode="numeric" min={0} value={cash} onChange={(e) => setCash(e.target.value)} />
          </FormField>
          <FormField label="Bankkártya – bk (Ft)">
            <Input type="number" inputMode="numeric" min={0} value={card} onChange={(e) => setCard(e.target.value)} />
          </FormField>
          <FormField label="Nyitó váltó (Ft)">
            <Input type="number" inputMode="numeric" min={0} value={float} onChange={(e) => setFloat(e.target.value)} />
          </FormField>
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">
          Napi bevétel <strong className="text-foreground">{ft(cashN + cardN)}</strong> · kasszában készpénz váltóval {ft(cashN + floatN)} · kassza összesen {ft(cashN + cardN + floatN)}
        </p>
        <ResultNotice result={result} />
        <DialogFooter>
          <Button
            disabled={pending || result?.ok === true}
            onClick={() =>
              start(async () => {
                const r = await setDayTakingsAction(dayId, cashN, cardN, floatN, null);
                setResult(r);
                if (r.ok) router.refresh();
              })
            }
          >
            Mentés
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
