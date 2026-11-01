"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, FormField, NativeSelect } from "@/components/form-bits";
import { cn } from "@/lib/utils";

export interface FieldRow {
  /** Stable React key; never submitted. */
  uid: string;
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "number" | "date" | "select";
  required: boolean;
  helpText: string;
  /** One option per line: `label`, or `value | label` to keep the stored value separate. */
  choicesText: string;
}

const TYPE_LABELS: Record<FieldRow["type"], string> = {
  text: "Short text",
  email: "Email",
  phone: "Phone",
  number: "Number",
  date: "Date",
  select: "Dropdown",
};

let counter = 0;
const nextUid = () => `f${Date.now().toString(36)}${counter++}`;

export function slugKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function fieldRowsFromDefs(
  defs: Array<{ key: string; label: string; type: string; required: boolean; helpText?: string; choices?: Array<{ value: string; label: string }> }>,
): FieldRow[] {
  return defs.map((def) => ({
    uid: nextUid(),
    key: def.key,
    label: def.label,
    type: (def.type as FieldRow["type"]) in TYPE_LABELS ? (def.type as FieldRow["type"]) : "text",
    required: def.required,
    helpText: def.helpText ?? "",
    choicesText: (def.choices ?? []).map((choice) => (choice.value === choice.label ? choice.label : `${choice.value} | ${choice.label}`)).join("\n"),
  }));
}

/** The JSON the server action reads: definitions in display order. */
export function serializeFieldRows(rows: FieldRow[]): string {
  const used = new Set<string>();
  return JSON.stringify(
    rows
      .filter((row) => row.label.trim())
      .map((row, index) => {
        let key = row.key.trim() || slugKey(row.label) || `field_${index + 1}`;
        while (used.has(key)) key = `${key}_2`;
        used.add(key);
        const base = { key, label: row.label.trim(), type: row.type, required: row.required, helpText: row.helpText.trim(), sortOrder: index };
        if (row.type !== "select") return base;
        const choices = row.choicesText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [first, ...rest] = line.split("|");
            const label = (rest.length ? rest.join("|") : first!).trim();
            return { value: rest.length ? first!.trim() : label, label };
          });
        return { ...base, choices };
      }),
  );
}

/** The key each saved row ends up with — what the eligibility rules refer to. */
export function effectiveFieldKeys(rows: FieldRow[]): Array<{ key: string; label: string }> {
  return (JSON.parse(serializeFieldRows(rows)) as Array<{ key: string; label: string }>).map(({ key, label }) => ({ key, label }));
}

/**
 * Edits the extra questions asked for every attendee. A new question gets a
 * key from its label; the key of a saved one is kept (it is what existing
 * bookings and eligibility rules point at), so it is shown but not editable
 * once the event exists.
 */
export function RegistrationFieldsEditor({
  rows,
  onChange,
  keysLocked,
}: {
  rows: FieldRow[];
  onChange: (rows: FieldRow[]) => void;
  /** Keys that already exist on the saved event. */
  keysLocked: Set<string>;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const patch = (uid: string, change: Partial<FieldRow>) => onChange(rows.map((row) => (row.uid === uid ? { ...row, ...change } : row)));
  const move = (index: number, direction: -1 | 1) => {
    const next = [...rows];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const add = () => {
    const row: FieldRow = { uid: nextUid(), key: "", label: "", type: "text", required: false, helpText: "", choicesText: "" };
    onChange([...rows, row]);
    setOpen(row.uid);
  };

  return (
    <div className="grid gap-3">
      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          No extra questions. Guests are asked for the basics only.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row, index) => {
            const expanded = open === row.uid || !row.label;
            return (
              <li key={row.uid} className="rounded-lg border">
                <div className="flex items-center gap-2 p-2 pl-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(expanded && row.label ? null : row.uid)}>
                    <span className="block truncate text-sm font-medium">{row.label || "New question"}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {TYPE_LABELS[row.type]}
                      {row.required ? " · required" : " · optional"}
                    </span>
                  </button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Move down" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove question" onClick={() => onChange(rows.filter((r) => r.uid !== row.uid))}>
                    <Trash2 />
                  </Button>
                </div>
                <div className={cn("grid gap-4 border-t p-4", !expanded && "hidden")}>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <FormField label="Question" htmlFor={`${row.uid}-label`}>
                      <Input id={`${row.uid}-label`} value={row.label} placeholder="Date of birth" onChange={(e) => patch(row.uid, { label: e.target.value })} />
                    </FormField>
                    <FormField label="Answer type" htmlFor={`${row.uid}-type`}>
                      <NativeSelect id={`${row.uid}-type`} value={row.type} onChange={(e) => patch(row.uid, { type: e.target.value as FieldRow["type"] })}>
                        {Object.entries(TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormField>
                  </div>
                  {row.type === "select" ? (
                    <FormField label="Options" htmlFor={`${row.uid}-choices`} hint="One per line. Use “value | label” to store something different from what guests see.">
                      <Textarea id={`${row.uid}-choices`} rows={4} value={row.choicesText} onChange={(e) => patch(row.uid, { choicesText: e.target.value })} />
                    </FormField>
                  ) : null}
                  <FormField label="Help text" htmlFor={`${row.uid}-help`} hint="Shown under the question.">
                    <Input id={`${row.uid}-help`} value={row.helpText} onChange={(e) => patch(row.uid, { helpText: e.target.value })} />
                  </FormField>
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <CheckboxField label="Required" checked={row.required} onCheckedChange={(required) => patch(row.uid, { required })} />
                    <FormField
                      label="Key"
                      htmlFor={`${row.uid}-key`}
                      className="w-56"
                      hint={keysLocked.has(row.key) ? "Fixed — existing bookings use it." : "How the answer is stored. Leave empty to generate."}
                    >
                      <Input
                        id={`${row.uid}-key`}
                        value={row.key}
                        placeholder={slugKey(row.label) || "generated"}
                        disabled={keysLocked.has(row.key)}
                        className="font-mono"
                        onChange={(e) => patch(row.uid, { key: slugKey(e.target.value) })}
                      />
                    </FormField>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus /> Add question
        </Button>
      </div>
    </div>
  );
}
