"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Phone, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Notice } from "@/components/notice";

export interface PassengerRow {
  attendeeKey: string;
  name: string;
  registrationNumber: string | null;
  phone: string;
  outbound: "boarded" | "not_boarded" | null;
  return: "boarded" | "not_boarded" | null;
}

type Leg = "outbound" | "return";
type Status = "boarded" | "not_boarded";

const TEXT = {
  en: {
    outbound: "Outbound",
    return: "Return",
    booked: "Booked",
    boarded: "Boarded",
    notBoarded: "Not boarded",
    missing: "Not marked",
    search: "Search by name or registration number",
    none: "No passenger matches.",
    empty: "Nobody is booked on this bus yet.",
    markBoarded: "Boarded",
    markNotBoarded: "Not boarded",
  },
  hu: {
    outbound: "Odaút",
    return: "Visszaút",
    booked: "Foglalt",
    boarded: "Felszállt",
    notBoarded: "Nem szállt fel",
    missing: "Jelöletlen",
    search: "Keresés névre vagy azonosítóra",
    none: "Nincs találat.",
    empty: "Erre a buszra még senki nem foglalt.",
    markBoarded: "Felszállt",
    markNotBoarded: "Nem szállt fel",
  },
} as const;

/**
 * A bus's passengers with a boarding status per leg. One tap marks a
 * passenger; tapping the active status again clears it. Shared by the
 * admin page and the captain's link page (each passes its own save action).
 */
export function PassengerList({
  passengers,
  onSet,
  lang = "en",
  refreshSeconds,
}: {
  passengers: PassengerRow[];
  onSet: (attendeeKey: string, leg: Leg, status: Status | null) => Promise<{ ok: boolean; message?: string }>;
  lang?: keyof typeof TEXT;
  /** Re-read the list periodically, so parallel markings show up. */
  refreshSeconds?: number;
}) {
  const t = TEXT[lang];
  const router = useRouter();
  const [leg, setLeg] = useState<Leg>("outbound");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [rows, applyOptimistic] = useOptimistic(passengers, (current, change: { attendeeKey: string; leg: Leg; status: Status | null }) =>
    current.map((row) => (row.attendeeKey === change.attendeeKey ? { ...row, [change.leg]: change.status } : row)),
  );

  useEffect(() => {
    if (!refreshSeconds) return;
    const timer = setInterval(() => router.refresh(), refreshSeconds * 1000);
    return () => clearInterval(timer);
  }, [refreshSeconds, router]);

  const counts = useMemo(() => {
    const boarded = rows.filter((row) => row[leg] === "boarded").length;
    const notBoarded = rows.filter((row) => row[leg] === "not_boarded").length;
    return { booked: rows.length, boarded, notBoarded, missing: rows.length - boarded - notBoarded };
  }, [rows, leg]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[\s-]+/g, "");
    if (!q) return rows;
    return rows.filter((row) => row.name.toLowerCase().replace(/\s+/g, "").includes(q) || (row.registrationNumber ?? "").toLowerCase().replace(/-/g, "").includes(q));
  }, [rows, query]);

  const mark = (row: PassengerRow, status: Status) => {
    const next = row[leg] === status ? null : status;
    startTransition(async () => {
      applyOptimistic({ attendeeKey: row.attendeeKey, leg, status: next });
      const result = await onSet(row.attendeeKey, leg, next);
      setError(result.ok ? null : (result.message ?? "Error"));
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4">
      <Tabs value={leg} onValueChange={(value) => setLeg(value as Leg)}>
        <TabsList className="w-full">
          <TabsTrigger value="outbound">{t.outbound}</TabsTrigger>
          <TabsTrigger value="return">{t.return}</TabsTrigger>
        </TabsList>
      </Tabs>
      <dl className="grid grid-cols-4 gap-2 text-center">
        {[
          [t.booked, counts.booked],
          [t.boarded, counts.boarded],
          [t.notBoarded, counts.notBoarded],
          [t.missing, counts.missing],
        ].map(([label, value]) => (
          <div key={label} className="bg-muted rounded-lg p-2">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} className="pl-9" aria-label={t.search} />
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {rows.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">{t.empty}</p>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">{t.none}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {visible.map((row) => {
            const status = row[leg];
            return (
              <li key={row.attendeeKey} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{row.name}</p>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-xs">
                    {row.registrationNumber ? <span className="font-mono">{row.registrationNumber}</span> : null}
                    {row.phone ? (
                      <a href={`tel:${row.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 hover:underline">
                        <Phone className="size-3" /> {row.phone}
                      </a>
                    ) : null}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={status === "boarded" ? "default" : "outline"}
                    aria-pressed={status === "boarded"}
                    onClick={() => mark(row, "boarded")}
                  >
                    <Check /> {t.markBoarded}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={status === "not_boarded" ? "destructive" : "outline"}
                    aria-pressed={status === "not_boarded"}
                    onClick={() => mark(row, "not_boarded")}
                  >
                    <X /> {t.markNotBoarded}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
