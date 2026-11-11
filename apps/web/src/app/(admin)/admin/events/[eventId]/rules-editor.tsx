"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CheckboxField, FormField, NativeSelect } from "@/components/form-bits";

/* ---- Who may register -------------------------------------------------- */

export interface FormRuleRow {
  uid: string;
  fieldKey: string;
  op: string;
  value: string;
  message: string;
}

export interface EligibilityValues {
  preset: string;
  minAge: number | "";
  maxAge: number | "";
  genders: string[];
  birthDateFieldKey: string;
  genderFieldKey: string;
  logic: "and" | "or";
  rules: FormRuleRow[];
}

const RULE_OPS: Array<{ value: string; label: string; hint: string }> = [
  { value: "equals", label: "is", hint: "Exactly this answer" },
  { value: "not_equals", label: "is not", hint: "Anything but this answer" },
  { value: "in", label: "is one of", hint: "Comma-separated answers" },
  { value: "not_in", label: "is none of", hint: "Comma-separated answers" },
  { value: "contains", label: "contains", hint: "Part of the answer" },
  { value: "regex", label: "matches pattern", hint: "A regular expression" },
  { value: "min", label: "is at least", hint: "A number" },
  { value: "max", label: "is at most", hint: "A number" },
  { value: "min_age", label: "gives age at least", hint: "For a date-of-birth question" },
  { value: "max_age", label: "gives age at most", hint: "For a date-of-birth question" },
  { value: "in_list", label: "is on the list", hint: "Checked against an uploaded data list" },
  { value: "not_in_list", label: "is not on the list", hint: "Checked against an uploaded data list" },
];

const GENDERS = [
  { value: "female", label: "Women" },
  { value: "male", label: "Men" },
];

let counter = 0;
export const newRuleUid = () => `r${Date.now().toString(36)}${counter++}`;

export function EligibilityEditor({
  value,
  onChange,
  fields,
  dataLists = [],
}: {
  value: EligibilityValues;
  onChange: (value: EligibilityValues) => void;
  /** The questions the form asks, to point rules at. */
  fields: Array<{ key: string; label: string }>;
  /** The organization's data lists (Data page), for list rules. */
  dataLists?: Array<{ id: string; name: string }>;
}) {
  const set = (patch: Partial<EligibilityValues>) => onChange({ ...value, ...patch });
  const setRule = (uid: string, patch: Partial<FormRuleRow>) =>
    set({ rules: value.rules.map((rule) => (rule.uid === uid ? { ...rule, ...patch } : rule)) });

  return (
    <div className="grid gap-5">
      <FormField label="Restriction" htmlFor="eligibilityPreset" hint="Checked when someone registers — a guest who doesn't qualify can't complete the booking.">
        <NativeSelect id="eligibilityPreset" value={value.preset} onChange={(e) => set({ preset: e.target.value })}>
          <option value="none">Open to everyone</option>
          <option value="custom">Age and gender limits</option>
          <option value="form_rules">Rules on the registration answers</option>
        </NativeSelect>
      </FormField>

      {value.preset === "custom" ? (
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <FormField label="Minimum age" htmlFor="eligibilityMinAge" hint="Age on the day the event starts.">
              <Input id="eligibilityMinAge" type="number" min={0} max={120} value={value.minAge} onChange={(e) => set({ minAge: e.target.value === "" ? "" : Number(e.target.value) })} />
            </FormField>
            <FormField label="Maximum age" htmlFor="eligibilityMaxAge">
              <Input id="eligibilityMaxAge" type="number" min={0} max={120} value={value.maxAge} onChange={(e) => set({ maxAge: e.target.value === "" ? "" : Number(e.target.value) })} />
            </FormField>
            <FormField label="Date of birth question" htmlFor="eligibilityBirthDateFieldKey">
              <FieldSelect id="eligibilityBirthDateFieldKey" value={value.birthDateFieldKey} onChange={(birthDateFieldKey) => set({ birthDateFieldKey })} fields={fields} />
            </FormField>
            <FormField label="Gender question" htmlFor="eligibilityGenderFieldKey">
              <FieldSelect id="eligibilityGenderFieldKey" value={value.genderFieldKey} onChange={(genderFieldKey) => set({ genderFieldKey })} fields={fields} />
            </FormField>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Open to</legend>
            <div className="flex flex-wrap gap-5">
              {GENDERS.map((gender) => (
                <CheckboxField
                  key={gender.value}
                  label={gender.label}
                  checked={value.genders.includes(gender.value)}
                  onCheckedChange={(on) => set({ genders: on ? [...value.genders, gender.value] : value.genders.filter((g) => g !== gender.value) })}
                />
              ))}
            </div>
            <p className="text-muted-foreground text-xs">Tick none to allow everyone. Age and gender limits need a date-of-birth / gender question on the form.</p>
          </fieldset>
        </div>
      ) : null}

      {value.preset === "form_rules" ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            A guest qualifies when
            <NativeSelect aria-label="Match all or any" className="w-28" value={value.logic} onChange={(e) => set({ logic: e.target.value as "and" | "or" })}>
              <option value="and">all</option>
              <option value="or">any</option>
            </NativeSelect>
            of these are true:
          </div>
          {value.rules.map((rule) => (
            <div key={rule.uid} className="grid items-end gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <FormField label="Answer to" htmlFor={`${rule.uid}-field`}>
                <FieldSelect id={`${rule.uid}-field`} value={rule.fieldKey} onChange={(fieldKey) => setRule(rule.uid, { fieldKey })} fields={fields} required />
              </FormField>
              <FormField label="Condition" htmlFor={`${rule.uid}-op`}>
                <NativeSelect id={`${rule.uid}-op`} value={rule.op} onChange={(e) => setRule(rule.uid, { op: e.target.value })}>
                  {RULE_OPS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Value" htmlFor={`${rule.uid}-value`} hint={RULE_OPS.find((op) => op.value === rule.op)?.hint}>
                {rule.op === "in_list" || rule.op === "not_in_list" ? (
                  <NativeSelect id={`${rule.uid}-value`} value={rule.value} onChange={(e) => setRule(rule.uid, { value: e.target.value })}>
                    <option value="">Choose a list…</option>
                    {dataLists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                    {rule.value && !dataLists.some((list) => list.id === rule.value) ? <option value={rule.value}>Deleted list</option> : null}
                  </NativeSelect>
                ) : (
                  <Input id={`${rule.uid}-value`} value={rule.value} onChange={(e) => setRule(rule.uid, { value: e.target.value })} />
                )}
              </FormField>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove rule" onClick={() => set({ rules: value.rules.filter((r) => r.uid !== rule.uid) })}>
                <Trash2 />
              </Button>
              <FormField label="Message if it fails (optional)" htmlFor={`${rule.uid}-message`} className="md:col-span-4">
                <Input id={`${rule.uid}-message`} value={rule.message} placeholder="Only members of a registered club can enter." onChange={(e) => setRule(rule.uid, { message: e.target.value })} />
              </FormField>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set({ rules: [...value.rules, { uid: newRuleUid(), fieldKey: fields[0]?.key ?? "", op: "equals", value: "", message: "" }] })}
            >
              <Plus /> Add rule
            </Button>
          </div>
          {fields.length === 0 ? <p className="text-muted-foreground text-xs">Add questions under “Registration form” first — rules read the guests' answers.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function FieldSelect({
  id,
  value,
  onChange,
  fields,
  required,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  fields: Array<{ key: string; label: string }>;
  required?: boolean;
}) {
  // A saved key whose question was since removed stays selectable so it isn't dropped silently.
  const known = fields.some((field) => field.key === value);
  return (
    <NativeSelect id={id} value={value} required={required} onChange={(e) => onChange(e.target.value)}>
      {required ? <option value="" disabled>Choose a question…</option> : <option value="">Detect automatically</option>}
      {fields.map((field) => (
        <option key={field.key} value={field.key}>
          {field.label}
        </option>
      ))}
      {value && !known ? <option value={value}>{value} (removed)</option> : null}
    </NativeSelect>
  );
}

/* ---- Price adjustments --------------------------------------------------- */

export interface PricingRuleRow {
  uid: string;
  id: string;
  enabled: boolean;
  label: string;
  when: string;
  action: string;
  amount: number | "";
  amountMode: string;
}

const WHEN_OPTIONS = [
  { value: "always", label: "Always" },
  { value: "with_hotel", label: "When the booking includes a hotel" },
  { value: "without_hotel", label: "When it has no hotel" },
  { value: "with_package", label: "When a hotel package is chosen" },
];

const ACTION_OPTIONS = [
  { value: "set_ticket_fee", label: "Set the ticket price to" },
  { value: "adjust_ticket", label: "Adjust the ticket price by" },
  { value: "adjust_accommodation", label: "Adjust the accommodation by" },
  { value: "adjust_total", label: "Adjust the total by" },
];

const AMOUNT_MODES = [
  { value: "fixed", label: "A fixed amount" },
  { value: "per_person", label: "Per person" },
  { value: "per_team", label: "Per team" },
  { value: "per_team_member", label: "Per team member" },
  { value: "per_accommodation_guest", label: "Per guest staying" },
  { value: "percent_ticket", label: "% of the ticket price" },
  { value: "percent_accommodation", label: "% of the accommodation" },
];

export function PricingRulesEditor({ rows, onChange }: { rows: PricingRuleRow[]; onChange: (rows: PricingRuleRow[]) => void }) {
  const patch = (uid: string, change: Partial<PricingRuleRow>) => onChange(rows.map((row) => (row.uid === uid ? { ...row, ...change } : row)));
  return (
    <div className="grid gap-3">
      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          No price adjustments. Everyone pays the ticket price.
        </p>
      ) : null}
      {rows.map((row) => (
        <div key={row.uid} className="grid gap-3 rounded-lg border p-3">
          <div className="flex items-end gap-3">
            <FormField label="Name on the invoice" htmlFor={`${row.uid}-label`} className="flex-1">
              <Input id={`${row.uid}-label`} value={row.label} onChange={(e) => patch(row.uid, { label: e.target.value })} />
            </FormField>
            <label className="flex h-9 items-center gap-2 text-sm">
              <Switch checked={row.enabled} onCheckedChange={(enabled) => patch(row.uid, { enabled })} /> On
            </label>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove adjustment" onClick={() => onChange(rows.filter((r) => r.uid !== row.uid))}>
              <Trash2 />
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField label="When" htmlFor={`${row.uid}-when`}>
              <NativeSelect id={`${row.uid}-when`} value={row.when} onChange={(e) => patch(row.uid, { when: e.target.value })}>
                {WHEN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Do" htmlFor={`${row.uid}-action`}>
              <NativeSelect id={`${row.uid}-action`} value={row.action} onChange={(e) => patch(row.uid, { action: e.target.value })}>
                {ACTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Amount" htmlFor={`${row.uid}-amount`} hint="Negative for a discount.">
              <Input id={`${row.uid}-amount`} type="number" step="any" value={row.amount} onChange={(e) => patch(row.uid, { amount: e.target.value === "" ? "" : Number(e.target.value) })} />
            </FormField>
            <FormField label="Counted as" htmlFor={`${row.uid}-mode`}>
              <NativeSelect id={`${row.uid}-mode`} value={row.amountMode} onChange={(e) => patch(row.uid, { amountMode: e.target.value })}>
                {AMOUNT_MODES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...rows,
              { uid: newRuleUid(), id: "", enabled: true, label: "", when: "always", action: "adjust_ticket", amount: 0, amountMode: "fixed" },
            ])
          }
        >
          <Plus /> Add adjustment
        </Button>
      </div>
    </div>
  );
}

export function serializeFormRules(value: EligibilityValues): string {
  return JSON.stringify({
    logic: value.logic,
    rules: value.rules.filter((rule) => rule.fieldKey).map((rule) => ({ id: rule.uid, fieldKey: rule.fieldKey, op: rule.op, value: rule.value, message: rule.message })),
  });
}

export function serializePricingRules(rows: PricingRuleRow[]): string {
  return JSON.stringify(
    rows
      .filter((row) => row.label.trim())
      .map((row) => ({
        id: row.id || row.uid,
        enabled: row.enabled,
        label: row.label.trim(),
        when: row.when,
        action: row.action,
        amount: Number(row.amount) || 0,
        amountMode: row.amountMode,
      })),
  );
}
