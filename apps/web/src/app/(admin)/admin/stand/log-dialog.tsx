"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "@/components/notice";
import { listEntriesAction, stornoEntryAction, type StandEntryDto } from "./actions";
import type { StandDayDto } from "./dto";

const time = (iso: string) => new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
const ft = (n: number) => `${n.toLocaleString("hu-HU")} Ft`;

/**
 * What was done today, newest first. Each sale, internal use or restock can
 * be reversed (storno) once; the reversal is a new line, nothing is erased.
 * A day opened before the log existed has fewer lines than its counters —
 * those are reversed from the product ("−" on its row).
 */
export function LogDialog({ dayId, canStorno, onClose, onDay }: { dayId: string; canStorno: boolean; onClose: () => void; onDay: (day: StandDayDto) => void }) {
  const [entries, setEntries] = useState<StandEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function load() {
    const result = await listEntriesAction(dayId);
    if (result.ok) setEntries(result.entries);
    else setError(result.message ?? "Failed.");
  }

  useEffect(() => {
    let cancelled = false;
    listEntriesAction(dayId).then((result) => {
      if (cancelled) return;
      if (result.ok) setEntries(result.entries);
      else setError(result.message ?? "Failed.");
    });
    return () => {
      cancelled = true;
    };
  }, [dayId]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Napló</DialogTitle>
          <DialogDescription>
            A nap műveletei, legújabb elöl. A storno új sorként kerül be, semmi sem törlődik. A napló a frissítés utáni műveleteket tartalmazza; korábbi tételeket a termék „−” (Storno) gombjával vonhatsz vissza.
          </DialogDescription>
        </DialogHeader>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {entries === null ? <p className="text-muted-foreground text-sm">Betöltés…</p> : null}
        {entries?.length === 0 ? <p className="text-muted-foreground text-sm">Még nincs naplózott művelet.</p> : null}
        <ul className="grid gap-1">
          {entries?.map((e) => {
            const reversible = canStorno && !e.storno && !e.stornoed && e.quantity > 0 && e.field !== "opening";
            return (
              <li key={e.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="text-muted-foreground w-20 shrink-0 tabular-nums">{time(e.at)}</span>
                <span className="grid min-w-0 flex-1">
                  <span className={e.stornoed ? "text-muted-foreground line-through" : "font-medium"}>
                    {e.productName} · {e.label}{" "}
                    {e.field === "opening" ? `${e.previous ?? "?"} → ${e.quantity} db` : `${e.quantity > 0 ? "+" : ""}${e.quantity} db`}
                    {e.value !== null ? ` · ${ft(e.value)}` : ""}
                  </span>
                  {e.reason ? <span className="text-muted-foreground text-xs">{e.reason}</span> : null}
                  <span className="text-muted-foreground text-xs">{e.by}</span>
                </span>
                {e.storno ? <Badge variant="warning">storno</Badge> : null}
                {e.stornoed ? <Badge variant="outline">stornózva</Badge> : null}
                {reversible ? (
                  confirming === e.id ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await stornoEntryAction(e.id);
                          setConfirming(null);
                          if (r.ok && r.day) {
                            onDay(r.day);
                            setError(null);
                            await load();
                          } else setError(r.message ?? "Failed.");
                        })
                      }
                    >
                      Biztos?
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setConfirming(e.id)}>
                      Storno
                    </Button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
