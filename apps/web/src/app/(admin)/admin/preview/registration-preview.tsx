"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { isFieldVisible } from "@tbook/domain";
import type { AttendeeFieldDef, AttendeeFieldValue } from "@tbook/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, FormField, NativeSelect } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import { previewCheckAction, previewPrefillAction, type PreviewResult } from "./actions";

interface PrefillInfo {
  fieldKey: string;
  label: string;
  helpText: string;
}

type Answers = Record<string, AttendeeFieldValue>;

/**
 * The registration form as the website renders it from the API: the same
 * questions, conditions and live options. With an ID lookup configured it
 * starts with the ID, then fills the rest from the data list (editable).
 * "Check" runs the server's registration checks without registering.
 */
export function RegistrationPreview({ eventId, fields, prefill }: { eventId: string; fields: AttendeeFieldDef[]; prefill: PrefillInfo | null }) {
  const [step, setStep] = useState<"id" | "form">(prefill ? "id" : "form");
  const [code, setCode] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [lookup, setLookup] = useState<{ tone: "info" | "warning" | "danger" | "success"; text: string } | null>(null);
  const [lastPrefill, setLastPrefill] = useState<unknown>(null);
  const [check, setCheck] = useState<PreviewResult<null> | null>(null);
  const [pending, start] = useTransition();

  const visible = useMemo(() => fields.filter((field) => isFieldVisible(field, answers)), [fields, answers]);
  const submitted = useMemo(() => Object.fromEntries(visible.filter((f) => answers[f.key] !== undefined && answers[f.key] !== "").map((f) => [f.key, answers[f.key]!])), [visible, answers]);

  const set = (key: string, value: AttendeeFieldValue) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setCheck(null);
  };

  const runLookup = () =>
    start(async () => {
      const result = await previewPrefillAction(eventId, code);
      setLastPrefill(result.ok ? result.data : { error: result.message });
      if (!result.ok || !result.data) return setLookup({ tone: "danger", text: result.message ?? "Lookup failed." });
      if (result.data.alreadyRegistered) {
        return setLookup({ tone: "warning", text: "Ezzel az azonosítóval már regisztráltak. A weboldal ilyenkor a vendég önkiszolgáló oldalára irányít." });
      }
      if (!result.data.found) return setLookup({ tone: "danger", text: "Nincs ilyen azonosító a listában. A vendég nem tud továbblépni." });
      setLookup({ tone: "success", text: `Megtaláltuk — ${Object.keys(result.data.fields).length - 1} mezőt kitöltöttünk. Minden módosítható.` });
      setAnswers(result.data.fields);
      setCheck(null);
      setStep("form");
    });

  const runCheck = () =>
    start(async () => {
      setCheck(await previewCheckAction(eventId, submitted));
    });

  const nameKey = fields.find((f) => f.type === "text" && /név|name/i.test(`${f.key} ${f.label}`))?.key;
  const emailKey = fields.find((f) => f.type === "email")?.key;
  const phoneKey = fields.find((f) => f.type === "phone")?.key;
  const bookingBody = {
    eventId,
    guests: 1,
    customer: {
      name: nameKey ? String(answers[nameKey] ?? "") : "",
      email: emailKey ? String(answers[emailKey] ?? "") : "",
      phone: phoneKey ? String(answers[phoneKey] ?? "") : "",
    },
    attendees: [{ fields: submitted }],
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <SectionCard title="Regisztrációs űrlap" description="Így működik a weboldalon. A „Check” mindent ellenőriz, de nem regisztrál.">
        {step === "id" && prefill ? (
          <form
            className="grid max-w-md gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              runLookup();
            }}
          >
            <FormField label={prefill.label} htmlFor="preview-id" hint={prefill.helpText || "Az adataid ez alapján töltjük ki."}>
              <Input id="preview-id" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required />
            </FormField>
            {lookup ? <Notice tone={lookup.tone}>{lookup.text}</Notice> : null}
            <div>
              <Button type="submit" disabled={pending || !code.trim()}>
                <Search /> {pending ? "Keresés…" : "Tovább"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-4">
            {prefill ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep("id")}>
                  <ArrowLeft /> Másik azonosító
                </Button>
                {lookup ? <span className="text-muted-foreground text-sm">{lookup.text}</span> : null}
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {visible.map((field) => (
                <PreviewField key={field.key} field={field} value={answers[field.key]} locked={field.key === prefill?.fieldKey} onChange={(value) => set(field.key, value)} />
              ))}
            </div>
            {check ? (
              <Notice tone={check.ok ? "success" : "danger"}>
                <p>{check.message}</p>
                {check.issues?.length ? (
                  <ul className="mt-1 list-disc pl-5">
                    {check.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                ) : null}
              </Notice>
            ) : null}
            <div>
              <Button type="button" onClick={runCheck} disabled={pending}>
                {pending ? "Ellenőrzés…" : "Check (nem regisztrál)"}
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="API hívások" description="Amit a weboldal küld és kap. Csak tájékoztató, innen semmi nem megy ki.">
        <div className="grid gap-4 text-sm">
          <ApiBlock title={`GET /api/v1/events/${eventId}`} body={{ registrationPrefill: prefill, "event.attendeeFieldSchema": `${fields.length} questions` }} />
          {prefill ? <ApiBlock title={`POST /api/v1/events/${eventId}/prefill`} body={{ request: { code }, response: lastPrefill }} /> : null}
          <ApiBlock title="POST /api/v1/bookings" body={bookingBody} />
        </div>
      </SectionCard>
    </div>
  );
}

function ApiBlock({ title, body }: { title: string; body: unknown }) {
  return (
    <div className="grid gap-1">
      <p className="font-mono text-xs font-medium break-all">{title}</p>
      <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs leading-5">{JSON.stringify(body, null, 2)}</pre>
    </div>
  );
}

function PreviewField({
  field,
  value,
  locked,
  onChange,
}: {
  field: AttendeeFieldDef;
  value: AttendeeFieldValue | undefined;
  locked: boolean;
  onChange: (value: AttendeeFieldValue) => void;
}) {
  const id = `preview-${field.key}`;
  const label = `${field.label}${field.required ? " *" : ""}`;
  const text = value == null ? "" : String(value);

  if (field.type === "checkbox") {
    return (
      <div className="sm:col-span-2">
        <CheckboxField label={label} hint={field.helpText || undefined} checked={text === "true"} onCheckedChange={(on) => onChange(on ? "true" : "")} />
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <FormField label={label} htmlFor={id} hint={field.helpText || undefined}>
        <NativeSelect id={id} value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.choices ?? []).map((choice) => (
            <option key={choice.value} value={choice.value} disabled={/\(full\)$/.test(choice.label)}>
              {choice.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
    );
  }
  if (field.type === "textarea") {
    return (
      <div className="sm:col-span-2">
        <FormField label={label} htmlFor={id} hint={field.helpText || undefined}>
          <Textarea id={id} rows={2} value={text} onChange={(e) => onChange(e.target.value)} />
        </FormField>
      </div>
    );
  }
  const type = field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "phone" ? "tel" : "text";
  return (
    <FormField label={label} htmlFor={id} hint={locked ? "Az azonosító: a „Másik azonosító” gombbal változtatható." : field.helpText || undefined}>
      <Input
        id={id}
        type={type}
        value={text}
        readOnly={locked}
        autoComplete="off"
        onChange={(e) => onChange(field.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
      />
    </FormField>
  );
}
