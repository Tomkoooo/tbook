import type { ReactNode } from "react";
import { Check, Minus } from "lucide-react";
import { isCheckboxChecked } from "@tbook/domain";
import { Badge } from "@/components/ui/badge";
import { choiceTone } from "@/lib/answer-tone";
import { formatDate } from "@/lib/format";

/** The part of an event's registration question this card needs. */
export interface AnswerField {
  key: string;
  label: string;
  type?: string;
  identifier?: boolean;
  choices?: Array<{ value: string; label: string }>;
}

const CONSENT_LABEL_LENGTH = 48;

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/** One answer as the widget the question's type calls for: a coloured badge for a choice, a tick for a checkbox, a link for an email or phone. */
function AnswerValue({ field, value }: { field: AnswerField; value: unknown }): ReactNode {
  if (field.type === "checkbox") {
    return isCheckboxChecked(value as never) ? (
      <Badge variant="success">
        <Check /> Igen
      </Badge>
    ) : (
      <Badge variant="neutral">
        <Minus /> Nem
      </Badge>
    );
  }
  if (isEmpty(value)) return <span className="text-muted-foreground">—</span>;
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  const choices = field.choices ?? [];
  const choiceIndex = choices.findIndex((choice) => choice.value === text);
  if (field.type === "select" || choiceIndex >= 0) {
    const label = choices[choiceIndex]?.label ?? text;
    return (
      <Badge variant={choiceTone(choiceIndex, label)} className="h-auto max-w-full whitespace-normal text-left">
        {label}
      </Badge>
    );
  }
  if (field.type === "email") {
    return (
      <a className="text-primary break-all hover:underline" href={`mailto:${text}`}>
        {text}
      </a>
    );
  }
  if (field.type === "phone") {
    return (
      <a className="text-primary tabular-nums hover:underline" href={`tel:${text.replace(/[^\d+]/g, "")}`}>
        {text}
      </a>
    );
  }
  if (field.type === "date") return <span className="tabular-nums">{formatDate(text)}</span>;
  if (field.type === "textarea") return <span className="whitespace-pre-wrap">{text}</span>;
  if (field.identifier) return <span className="font-mono tabular-nums">{text}</span>;
  return <span>{text}</span>;
}

/**
 * One guest's registration answers, laid out from the event's question
 * schema: what was asked (the label), in the order it was asked, each answer
 * shown by its type. Long consent checkboxes ("I have read and accept …")
 * move into a footer of ticks instead of taking a grid cell each. Answers whose
 * question is no longer in the schema still show, under their raw key.
 */
export function GuestAnswers({ fields, schema }: { fields: Record<string, unknown> | undefined; schema: AnswerField[] }) {
  const stored = Object.entries(fields ?? {}).filter(([key]) => key !== "_id");
  if (stored.length === 0) return <span className="text-muted-foreground">—</span>;

  const known = new Map(schema.map((field) => [field.key, field]));
  const ordered: AnswerField[] = [...schema.filter((field) => stored.some(([key]) => key === field.key)), ...stored.filter(([key]) => !known.has(key)).map(([key]) => ({ key, label: key }))];
  const consents = ordered.filter((field) => field.type === "checkbox" && field.label.length > CONSENT_LABEL_LENGTH);
  const grid = ordered.filter((field) => !consents.includes(field));

  return (
    <div className="grid gap-3">
      {grid.length > 0 ? (
        <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {grid.map((field) => (
            <div key={field.key} className="min-w-0">
              <dt className="text-muted-foreground mb-0.5 text-xs">{field.label}</dt>
              <dd className="min-w-0 text-sm break-words">
                <AnswerValue field={field} value={fields?.[field.key]} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {consents.length > 0 ? (
        <ul className="grid gap-1 border-t pt-2.5">
          {consents.map((field) => {
            const checked = isCheckboxChecked(fields?.[field.key] as never);
            return (
              <li key={field.key} className="flex items-start gap-2 text-xs">
                <Badge variant={checked ? "success" : "neutral"} className="size-5 shrink-0 justify-center rounded-full p-0" aria-label={checked ? "Accepted" : "Not accepted"}>
                  {checked ? <Check /> : <Minus />}
                </Badge>
                <span className={checked ? "text-foreground" : "text-muted-foreground"}>{field.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
