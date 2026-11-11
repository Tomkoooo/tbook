"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/form-bits";
import { cn } from "@/lib/utils";

export interface SurveyFormQuestion {
  id: string;
  type: "rating" | "choice" | "text";
  label: string;
  required: boolean;
  choices: string[];
}

export interface SurveySubmitResult {
  ok: boolean;
  message?: string;
}

/**
 * The guest-facing feedback form (Hungarian). "survey" asks for the
 * registration number / ID unless a personal link already identified the
 * guest; "kiosk" is tap-only, large, and resets itself after each answer.
 */
export function SurveyForm({
  questions,
  ratingMax,
  mode,
  needsCode,
  thankYou,
  submit,
}: {
  questions: SurveyFormQuestion[];
  ratingMax: number;
  mode: "survey" | "kiosk";
  needsCode: boolean;
  thankYou: string;
  submit: (answers: Record<string, string | number>, code: string) => Promise<SurveySubmitResult>;
}) {
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [code, setCode] = useState("");
  const [result, setResult] = useState<SurveySubmitResult | null>(null);
  const [pending, start] = useTransition();
  const kiosk = mode === "kiosk";

  useEffect(() => {
    if (!kiosk || !result?.ok) return;
    const timer = setTimeout(() => {
      setAnswers({});
      setResult(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [kiosk, result]);

  if (result?.ok) {
    return (
      <div className="grid gap-2 py-8 text-center">
        <p className={cn("font-semibold", kiosk ? "text-3xl" : "text-xl")}>{thankYou || "Köszönjük a visszajelzésed!"}</p>
        {result.message ? <p className="text-muted-foreground">{result.message}</p> : null}
      </div>
    );
  }

  const set = (id: string, value: string | number) => setAnswers((current) => ({ ...current, [id]: value }));

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await submit(answers, code)));
      }}
    >
      {questions.map((question) => (
        <fieldset key={question.id} className="grid gap-2">
          <legend className={cn("mb-2 font-medium", kiosk ? "text-2xl" : "text-base")}>
            {question.label}
            {question.required ? <span className="text-destructive"> *</span> : null}
          </legend>
          {question.type === "rating" ? (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={question.label}>
              {Array.from({ length: ratingMax }, (_, i) => i + 1).map((value) => (
                <Button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={answers[question.id] === value}
                  variant={answers[question.id] === value ? "default" : "outline"}
                  className={cn(kiosk ? "size-20 text-3xl" : "size-12 text-lg")}
                  onClick={() => set(question.id, value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          ) : question.type === "choice" ? (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={question.label}>
              {question.choices.map((choice) => (
                <Button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={answers[question.id] === choice}
                  variant={answers[question.id] === choice ? "default" : "outline"}
                  size={kiosk ? "lg" : "default"}
                  className={cn(kiosk && "h-16 px-6 text-xl")}
                  onClick={() => set(question.id, choice)}
                >
                  {choice}
                </Button>
              ))}
            </div>
          ) : (
            <Textarea rows={3} value={String(answers[question.id] ?? "")} onChange={(e) => set(question.id, e.target.value)} />
          )}
        </fieldset>
      ))}

      {needsCode ? (
        <FormField label="Regisztrációs számod vagy törzsszámod" htmlFor="code">
          <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required />
        </FormField>
      ) : null}

      {result && !result.ok ? (
        <p className="text-destructive text-sm" role="alert">
          {result.message}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} className={cn(kiosk && "h-16 text-2xl")}>
        Küldés
      </Button>
    </form>
  );
}
