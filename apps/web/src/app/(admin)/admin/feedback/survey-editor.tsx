"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, FormField, NativeSelect } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { deleteSurveyAction, rotateKioskLinkAction, saveSurveyAction, type FeedbackActionResult } from "./actions";

interface QuestionRow {
  id?: string;
  type: "rating" | "choice" | "text";
  label: string;
  required: boolean;
  choices: string;
}

export interface SurveyEditorValue {
  id: string | null;
  kind: "survey" | "kiosk";
  title: string;
  intro: string;
  thankYou: string;
  active: boolean;
  questions: Array<{ id: string; type: "rating" | "choice" | "text"; label: string; required: boolean; choices: string[] }>;
}

export function SurveyEditor({ eventId, value }: { eventId: string; value: SurveyEditorValue }) {
  const [kind, setKind] = useState(value.kind);
  const [rows, setRows] = useState<QuestionRow[]>(
    value.questions.length > 0
      ? value.questions.map((q) => ({ ...q, choices: q.choices.join(", ") }))
      : [{ type: "rating", label: "", required: true, choices: "" }],
  );
  const [state, action, pending] = useActionState(
    (prev: FeedbackActionResult | null, form: FormData) => saveSurveyAction(value.id, eventId, prev, form),
    null,
  );
  const update = (index: number, patch: Partial<QuestionRow>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const serialized = JSON.stringify(
    rows.map((row) => ({ id: row.id, type: row.type, label: row.label, required: row.required, choices: row.choices.split(",").map((c) => c.trim()).filter(Boolean) })),
  );

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="questions" value={serialized} />
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <FormField label="Kind" htmlFor="kind" hint={value.id ? "Can't be changed after creation." : undefined}>
          <NativeSelect id="kind" name="kind" value={kind} disabled={Boolean(value.id)} onChange={(e) => setKind(e.target.value as "survey" | "kiosk")}>
            <option value="survey">Survey (once per guest)</option>
            <option value="kiosk">Kiosk (tablet at the venue)</option>
          </NativeSelect>
          {value.id ? <input type="hidden" name="kind" value={kind} /> : null}
        </FormField>
        <FormField label="Title" htmlFor="title">
          <Input id="title" name="title" defaultValue={value.title} required />
        </FormField>
      </div>
      <FormField label="Intro (optional)" htmlFor="intro">
        <Textarea id="intro" name="intro" rows={2} defaultValue={value.intro} />
      </FormField>
      <FormField label="Thank-you text (optional)" htmlFor="thankYou">
        <Input id="thankYou" name="thankYou" defaultValue={value.thankYou} placeholder="Köszönjük a visszajelzésed!" />
      </FormField>

      <div className="grid gap-3">
        <p className="text-sm font-medium">Questions</p>
        {rows.map((row, index) => (
          <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <FormField label="Type" htmlFor={`q-type-${index}`}>
              <NativeSelect id={`q-type-${index}`} value={row.type} onChange={(e) => update(index, { type: e.target.value as QuestionRow["type"] })}>
                <option value="rating">Rating 1–5</option>
                <option value="choice">Choice</option>
                {kind === "survey" ? <option value="text">Text</option> : null}
              </NativeSelect>
            </FormField>
            <FormField label="Question" htmlFor={`q-label-${index}`}>
              <Input id={`q-label-${index}`} value={row.label} onChange={(e) => update(index, { label: e.target.value })} />
            </FormField>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove question" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
              <Trash2 />
            </Button>
            {row.type === "choice" ? (
              <FormField label="Options (comma-separated)" htmlFor={`q-choices-${index}`} className="sm:col-span-3">
                <Input id={`q-choices-${index}`} value={row.choices} onChange={(e) => update(index, { choices: e.target.value })} />
              </FormField>
            ) : null}
            <div className="sm:col-span-3">
              <CheckboxField name={`q-required-${index}`} label="Required" checked={row.required} onCheckedChange={(checked) => update(index, { required: checked })} />
            </div>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" onClick={() => setRows((current) => [...current, { type: "rating", label: "", required: false, choices: "" }])}>
            <Plus /> Add question
          </Button>
        </div>
      </div>

      <CheckboxField name="active" label="Open for answers" defaultChecked={value.active} />

      {state?.message ? <Notice tone={state.ok ? "success" : "danger"}>{state.message}</Notice> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {value.id ? "Save" : "Create"}
        </Button>
        {value.id ? <DeleteSurveyButton surveyId={value.id} /> : null}
      </div>
    </form>
  );
}

function DeleteSurveyButton({ surveyId }: { surveyId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!confirming) {
    return (
      <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="destructive" disabled={pending} onClick={() => start(async () => setMessage((await deleteSurveyAction(surveyId)).message ?? null))}>
        Confirm delete
      </Button>
      {message ? <span className="text-muted-foreground text-sm">{message}</span> : null}
    </div>
  );
}

export function KioskLinkPanel({ surveyId, hint }: { surveyId: string; hint: string }) {
  const [result, setResult] = useState<FeedbackActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">
        {hint ? `A kiosk link exists (…${hint}). Creating a new one switches the old one off.` : "No kiosk link yet. Create one and open it on the venue tablet."}
      </p>
      {result?.kioskUrl ? (
        <Notice tone="success">
          Open this on the tablet (shown once): <span className="font-mono break-all">{result.kioskUrl}</span>
        </Notice>
      ) : result?.message && !result.ok ? (
        <Notice tone="danger">{result.message}</Notice>
      ) : null}
      <div>
        <Button variant="outline" disabled={pending} onClick={() => start(async () => setResult(await rotateKioskLinkAction(surveyId)))}>
          {hint ? "Create a new kiosk link" : "Create kiosk link"}
        </Button>
      </div>
    </div>
  );
}
