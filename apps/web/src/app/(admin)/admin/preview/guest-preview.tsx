"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import type { guestPortal } from "@tbook/modules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import { previewGuestAction, type PreviewResult } from "./actions";

/** What a guest sees after typing their registration number or ID on the website (read only here). */
export function GuestPreview({ eventId }: { eventId: string }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<PreviewResult<guestPortal.GuestView> | null>(null);
  const [pending, start] = useTransition();
  const guest = result?.ok ? result.data : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <SectionCard title="Vendég nézet" description="A vendég a regisztrációs számával vagy az azonosítójával lép be. Itt csak megnézheted, mit lát; módosítani nem lehet.">
        <form
          className="flex max-w-md flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            start(async () => setResult(await previewGuestAction(eventId, code)));
          }}
        >
          <FormField label="Regisztrációs szám vagy azonosító" htmlFor="guest-code" className="min-w-56 flex-1">
            <Input id="guest-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          </FormField>
          <Button type="submit" disabled={pending || !code.trim()}>
            <Search /> {pending ? "Keresés…" : "Belépés"}
          </Button>
        </form>

        {result && !result.ok ? (
          <div className="mt-4">
            <Notice tone="danger">{result.message}</Notice>
          </div>
        ) : null}

        {guest ? (
          <div className="mt-6 grid gap-5">
            <div className="grid gap-1">
              <p className="text-muted-foreground text-sm">{guest.eventName}</p>
              <p className="text-xl font-semibold">{guest.name}</p>
              <div className="flex flex-wrap gap-2">
                {guest.registrationNumber ? <Badge variant="neutral">{guest.registrationNumber}</Badge> : null}
                <Badge variant={guest.canEdit ? "success" : "neutral"}>{guest.canEdit ? "Módosíthat" : "Nem módosíthat"}</Badge>
                <Badge variant={guest.canCancel ? "warning" : "neutral"}>{guest.canCancel ? "Lemondhat" : "Nem mondhat le"}</Badge>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              {guest.form.map((field) => (
                <div key={field.key} className="grid gap-0.5">
                  <dt className="text-muted-foreground text-xs">
                    {field.label}
                    {field.editable ? "" : " · zárolt"}
                  </dt>
                  <dd className="text-sm">{displayValue(field, guest.fields[field.key])}</dd>
                </div>
              ))}
            </dl>
            {guest.bus ? (
              <div className="grid gap-1 rounded-lg border p-4 text-sm">
                <p className="font-medium">
                  Busz: {guest.bus.code} · {guest.bus.city}
                </p>
                <p className="text-muted-foreground">{[guest.bus.pickupPoint, guest.bus.departure].filter(Boolean).join(" · ")}</p>
                {guest.bus.returnInfo ? <p className="text-muted-foreground">Vissza: {guest.bus.returnInfo}</p> : null}
                {guest.bus.captainName ? (
                  <p className="text-muted-foreground">
                    Kapitány: {guest.bus.captainName} {guest.bus.captainPhone}
                  </p>
                ) : null}
              </div>
            ) : null}
            {guest.transferRules ? <p className="text-muted-foreground text-sm whitespace-pre-line">{guest.transferRules}</p> : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="API válasz" description="POST /api/v1/guest/lookup">
        <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs leading-5">
          {JSON.stringify(result ? (result.ok ? { guest: result.data } : { error: result.message }) : { request: { eventId, code } }, null, 2)}
        </pre>
      </SectionCard>
    </div>
  );
}

function displayValue(field: { type: string; choices?: Array<{ value: string; label: string }> }, value: unknown): string {
  if (value == null || value === "") return "—";
  if (field.type === "checkbox") return String(value) === "true" ? "Igen" : "Nem";
  if (field.type === "select") return field.choices?.find((choice) => choice.value === String(value))?.label ?? String(value);
  return String(value);
}
