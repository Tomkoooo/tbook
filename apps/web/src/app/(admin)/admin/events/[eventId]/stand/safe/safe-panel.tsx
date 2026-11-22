"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { FormField, ResultNotice } from "@/components/form-bits";
import { SectionCard } from "@/components/section-card";
import { Stat } from "@/components/stat";
import { addWithdrawalAction, stornoWithdrawalAction, type StandResult, type StandWithdrawalDto } from "../actions";

const ft = (n: number) => `${n.toLocaleString("hu-HU")} Ft`;
const when = (iso: string) => new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

/** Cash taken out of the internal cash (the safe), with the reason. */
export function SafePanel({ eventId, rows }: { eventId: string; rows: StandWithdrawalDto[] }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<StandResult | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const total = rows.filter((r) => !r.stornoed).reduce((sum, r) => sum + r.amountHuf, 0);

  return (
    <div className="grid gap-4">
      <div className="grid max-w-xs">
        <Stat label="Összes kivét" value={ft(total)} hint="a stornózottak nélkül" />
      </div>
      <SectionCard title="Új kivét" description="Mennyi pénz került ki a belső kasszából (széf), és miért.">
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <FormField label="Összeg (Ft)">
            <Input type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
          <FormField label="Miért">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="pl. beszerzés a nagykerből" />
          </FormField>
          <Button
            disabled={pending || !Number(amount) || !note.trim()}
            onClick={() =>
              start(async () => {
                const r = await addWithdrawalAction(eventId, Number(amount), note);
                setResult(r);
                if (r.ok) {
                  setAmount("");
                  setNote("");
                  router.refresh();
                }
              })
            }
          >
            Rögzítés
          </Button>
        </div>
        <div className="pt-3">
          <ResultNotice result={result} />
        </div>
      </SectionCard>

      <SectionCard title="Kivétek" flush>
        {rows.length === 0 ? (
          <EmptyState title="Még nincs kivét" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Időpont</TableHead>
                <TableHead>Összeg</TableHead>
                <TableHead>Miért</TableHead>
                <TableHead>Ki</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="tabular-nums">
                  <TableCell>{when(r.at)}</TableCell>
                  <TableCell className={r.stornoed ? "text-muted-foreground line-through" : "font-medium"}>{ft(r.amountHuf)}</TableCell>
                  <TableCell className={r.stornoed ? "text-muted-foreground line-through" : ""}>{r.note}</TableCell>
                  <TableCell className="text-muted-foreground">{r.by}</TableCell>
                  <TableCell className="text-right">
                    {r.stornoed ? (
                      <Badge variant="outline">stornózva</Badge>
                    ) : confirming === r.id ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            setResult(await stornoWithdrawalAction(r.id));
                            setConfirming(null);
                            router.refresh();
                          })
                        }
                      >
                        Biztos?
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirming(r.id)}>
                        Storno
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
