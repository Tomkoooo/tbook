"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmailEditor, type PlaceholderGroup } from "@/components/email-editor";
import { CheckboxField, FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import {
  countRecipientsAction,
  deleteEventEmailAction,
  emailProgressAction,
  saveEventEmailAction,
  sendTestEmailAction,
  startEmailSendAction,
  stopEmailSendAction,
  type EmailActionResult,
  type SendProgress,
} from "../email-actions";

type Placeholder = { key: string; label: string; sample: string };

export function EmailEventPicker({ events, value }: { events: Array<{ id: string; name: string }>; value: string }) {
  const router = useRouter();
  return (
    <NativeSelect aria-label="Event" value={value} className="w-64" onChange={(e) => router.push(`/admin/emails?eventId=${e.target.value}`)}>
      {events.map((event) => (
        <option key={event.id} value={event.id}>
          {event.name}
        </option>
      ))}
    </NativeSelect>
  );
}

interface ConditionRow {
  fieldKey: string;
  op: string;
  value: string;
}

const CONDITION_OPS = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "in", label: "is one of" },
  { value: "not_in", label: "is none of" },
  { value: "contains", label: "contains" },
  { value: "is_empty", label: "is empty (not answered)" },
  { value: "is_not_empty", label: "is answered (any value)" },
];

/** Conditions that need no value. */
const VALUELESS_OPS = new Set(["is_empty", "is_not_empty"]);

export interface EmailFormValues {
  name: string;
  subject: string;
  body: string;
  trigger: "on_registration" | "manual";
  audience: "registered" | "list_all" | "list_unregistered";
  listId: string;
  listMatchFieldKey: string;
  conditions: ConditionRow[];
  conditionLogic: "and" | "or";
  attachTicket: boolean;
  active: boolean;
  sortOrder: number;
}

export function EmailForm({
  eventId,
  emailId,
  initial,
  fields,
  lists,
  placeholders,
}: {
  eventId: string;
  emailId: string | null;
  initial: EmailFormValues;
  fields: Array<{ key: string; label: string; choices: Array<{ value: string; label: string }> }>;
  lists: Array<{ id: string; name: string; hasEmail: boolean; columns: Array<{ key: string; label: string }> }>;
  placeholders: { attendee: Placeholder[]; list: Placeholder[]; fields: Placeholder[]; modules: Array<{ label: string; items: Placeholder[] }> };
}) {
  const router = useRouter();
  const [trigger, setTrigger] = useState(initial.trigger);
  const [audience, setAudience] = useState(initial.audience);
  const [listId, setListId] = useState(initial.listId);
  const [conditions, setConditions] = useState<ConditionRow[]>(initial.conditions);
  const [logic, setLogic] = useState(initial.conditionLogic);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, startDelete] = useTransition();

  const effectiveAudience = trigger === "on_registration" ? "registered" : audience;
  const list = lists.find((l) => l.id === listId) ?? null;

  const groups: PlaceholderGroup[] = useMemo(() => {
    if (effectiveAudience !== "registered") {
      return [
        { label: "General", items: placeholders.list },
        { label: "List columns", items: (list?.columns ?? []).map((c) => ({ key: `list.${c.key}`, label: `List: ${c.label}`, sample: c.label })) },
      ];
    }
    return [
      { label: "Guest and event", items: placeholders.attendee },
      { label: "Registration answers", items: placeholders.fields },
      ...placeholders.modules.map((group) => ({ label: group.label === "bus-transport" ? "Bus" : group.label, items: group.items })),
    ];
  }, [effectiveAudience, list, placeholders]);

  const [state, action, pending] = useActionState(async (_prev: EmailActionResult | null, formData: FormData) => {
    const result = await saveEventEmailAction(eventId, emailId, formData);
    if (result.ok && !emailId && result.id) router.replace(`/admin/emails/${result.id}`);
    return result;
  }, null);

  const serializedConditions =
    effectiveAudience === "registered" && conditions.some((c) => c.fieldKey)
      ? JSON.stringify({ logic, rules: conditions.filter((c) => c.fieldKey).map((c, index) => ({ id: `c${index + 1}`, fieldKey: c.fieldKey, op: c.op, value: c.value.trim(), message: "" })) })
      : "";

  return (
    <form action={action} className="grid gap-6">
      <input type="hidden" name="conditions" value={serializedConditions} />
      <SectionCard title="Settings">
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <FormField label="Name" htmlFor="email-name" hint="For you — guests don’t see it.">
              <Input id="email-name" name="name" defaultValue={initial.name} required placeholder="Regisztráció megnyitása" />
            </FormField>
            <FormField label="Order" htmlFor="email-order">
              <Input id="email-order" name="sortOrder" type="number" defaultValue={initial.sortOrder} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="When" htmlFor="email-trigger">
              <NativeSelect id="email-trigger" name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as EmailFormValues["trigger"])}>
                <option value="on_registration">Automatically, to each guest when they register</option>
                <option value="manual">When I press Send</option>
              </NativeSelect>
            </FormField>
            {trigger === "manual" ? (
              <FormField label="To" htmlFor="email-audience">
                <NativeSelect id="email-audience" name="audience" value={audience} onChange={(e) => setAudience(e.target.value as EmailFormValues["audience"])}>
                  <option value="registered">Registered guests</option>
                  <option value="list_all">Everyone on a data list</option>
                  <option value="list_unregistered">People on a data list who haven’t registered yet</option>
                </NativeSelect>
              </FormField>
            ) : (
              <input type="hidden" name="audience" value="registered" />
            )}
          </div>

          {effectiveAudience !== "registered" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Data list" htmlFor="email-list" hint={list && !list.hasEmail ? "This list has no email column — re-import it and pick one." : undefined}>
                <NativeSelect id="email-list" name="listId" value={listId} onChange={(e) => setListId(e.target.value)}>
                  <option value="">Choose a list…</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.hasEmail ? "" : " (no email column)"}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              {effectiveAudience === "list_unregistered" ? (
                <FormField label="Registration question holding the list key" htmlFor="email-match" hint="E.g. the employee ID question — matched the way the list compares keys.">
                  <NativeSelect id="email-match" name="listMatchFieldKey" defaultValue={initial.listMatchFieldKey}>
                    <option value="">Choose a question…</option>
                    {fields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              ) : null}
            </div>
          ) : (
            <ConditionEditor fields={fields} rows={conditions} onChange={setConditions} logic={logic} onLogicChange={setLogic} />
          )}

          <div className="flex flex-wrap gap-6">
            <CheckboxField name="active" label={trigger === "on_registration" ? "On — send on each registration" : "On"} defaultChecked={initial.active} />
            {effectiveAudience === "registered" ? <CheckboxField name="attachTicket" label="Attach the guest’s ticket PDF" defaultChecked={initial.attachTicket} /> : null}
          </div>
          {trigger === "on_registration" ? (
            <Notice tone="info">While an automatic email is on, it replaces tBook’s default booking confirmation for this event. Each guest of a group registration gets their own copy.</Notice>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Message" description="Use the informal tone the event uses. {{siteUrl}} links the event website (set it in the event's Modules section).">
        <EmailEditor
          initialSubject={initial.subject}
          initialBody={initial.body}
          placeholderGroups={groups}
          previewNote={effectiveAudience === "registered" ? "{{qrCode}} becomes the guest’s own QR code image (the same one as on the ticket)." : "List emails have no QR code or ticket."}
        />
      </SectionCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        {emailId ? (
          <Button type="button" variant="ghost" onClick={() => setDeleteOpen(true)}>
            <Trash2 /> Delete
          </Button>
        ) : null}
        <div className="min-w-64 flex-1">
          <ResultNotice result={state} />
        </div>
      </div>

      {emailId ? (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this email?</DialogTitle>
              <DialogDescription>Its delivery log is deleted too.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleting}
                onClick={() =>
                  startDelete(async () => {
                    const result = await deleteEventEmailAction(emailId);
                    if (result.ok) router.replace(`/admin/emails?eventId=${eventId}`);
                    setDeleteOpen(false);
                  })
                }
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </form>
  );
}

function ConditionEditor({
  fields,
  rows,
  onChange,
  logic,
  onLogicChange,
}: {
  fields: Array<{ key: string; label: string; choices: Array<{ value: string; label: string }> }>;
  rows: ConditionRow[];
  onChange: (rows: ConditionRow[]) => void;
  logic: "and" | "or";
  onLogicChange: (logic: "and" | "or") => void;
}) {
  const patch = (index: number, change: Partial<ConditionRow>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-medium">Only to guests whose answers match (optional)</legend>
      {rows.length > 1 ? (
        <div className="flex items-center gap-2 text-sm">
          Match
          <NativeSelect aria-label="Match all or any" className="w-24" value={logic} onChange={(e) => onLogicChange(e.target.value as "and" | "or")}>
            <option value="and">all</option>
            <option value="or">any</option>
          </NativeSelect>
          of these:
        </div>
      ) : null}
      {rows.map((row, index) => {
        const field = fields.find((f) => f.key === row.fieldKey);
        return (
          <div key={index} className="grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto]">
            <FormField label="Answer to" htmlFor={`cond-${index}-field`}>
              <NativeSelect id={`cond-${index}-field`} value={row.fieldKey} onChange={(e) => patch(index, { fieldKey: e.target.value, value: "" })}>
                <option value="">Choose a question…</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Condition" htmlFor={`cond-${index}-op`}>
              <NativeSelect id={`cond-${index}-op`} value={row.op} onChange={(e) => patch(index, VALUELESS_OPS.has(e.target.value) ? { op: e.target.value, value: "" } : { op: e.target.value })}>
                {CONDITION_OPS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Value" htmlFor={`cond-${index}-value`}>
              {VALUELESS_OPS.has(row.op) ? (
                <Input id={`cond-${index}-value`} value="" disabled placeholder="—" aria-label="No value needed" />
              ) : field && field.choices.length > 0 && (row.op === "equals" || row.op === "not_equals") ? (
                <NativeSelect id={`cond-${index}-value`} value={row.value} onChange={(e) => patch(index, { value: e.target.value })}>
                  <option value="">Choose…</option>
                  {field.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input id={`cond-${index}-value`} value={row.value} onChange={(e) => patch(index, { value: e.target.value })} />
              )}
            </FormField>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove condition" onClick={() => onChange(rows.filter((_, i) => i !== index))}>
              <Trash2 />
            </Button>
          </div>
        );
      })}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { fieldKey: fields[0]?.key ?? "", op: "equals", value: "" }])}>
          <Plus /> Add condition
        </Button>
      </div>
    </fieldset>
  );
}

/** Test send for every email; for manual ones also Send now / Stop with live progress. */
export function SendPanel({ emailId, manual }: { emailId: string; manual: boolean }) {
  const router = useRouter();
  const [testTo, setTestTo] = useState("");
  const [result, setResult] = useState<EmailActionResult | null>(null);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [confirm, setConfirm] = useState<{ count: number } | null>(null);
  const [resendAll, setResendAll] = useState(false);
  const [pending, startTransition] = useTransition();

  const running = progress?.status === "running";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await emailProgressAction(emailId);
      if (!cancelled) setProgress(next);
    };
    void load();
    if (!running) return () => void (cancelled = true);
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [emailId, running]);

  // Refresh the delivery log once a send finishes.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) router.refresh();
    wasRunning.current = running;
  }, [running, router]);

  const done = progress ? progress.sent + progress.failed + progress.skipped : 0;

  return (
    <SectionCard title={manual ? "Send" : "Test"} description={manual ? "Check it with a test first. Send only reaches people who haven’t received it yet, so pressing it again after a stop or a failure only finishes the rest." : "Automatic emails go out on each registration. Send yourself a copy to check it."}>
      <div className="grid gap-5">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Send a test to" htmlFor="test-to" className="min-w-64 flex-1">
            <Input id="test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="te@example.com" />
          </FormField>
          <Button type="button" variant="outline" disabled={pending || !testTo} onClick={() => startTransition(async () => setResult(await sendTestEmailAction(emailId, testTo)))}>
            <Send /> Send test
          </Button>
        </div>

        {manual ? (
          <div className="grid gap-3 border-t pt-4">
            {progress && progress.status !== "idle" ? (
              <div className="grid gap-1.5">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {progress.status === "running" ? "Sending…" : progress.status === "done" ? "Finished" : "Stopped"}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {done} / {progress.total} · {progress.sent} sent · {progress.failed} failed · {progress.skipped} already had it
                  </span>
                </div>
                <progress className="accent-primary h-2 w-full" value={done} max={Math.max(progress.total, 1)} />
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {running ? (
                <Button type="button" variant="destructive" disabled={pending} onClick={() => startTransition(async () => setResult(await stopEmailSendAction(emailId)))}>
                  <Square /> Stop
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const counted = await countRecipientsAction(emailId);
                      if (!counted.ok) setResult(counted);
                      else setConfirm({ count: counted.count ?? 0 });
                    })
                  }
                >
                  <Send /> Send now…
                </Button>
              )}
              <CheckboxField label="Also resend to people who already received it" checked={resendAll} onCheckedChange={setResendAll} disabled={running} />
            </div>
          </div>
        ) : null}

        <ResultNotice result={result} />
      </div>

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => (open ? null : setConfirm(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this email now?</DialogTitle>
            <DialogDescription>
              {confirm?.count ?? 0} recipients match right now.{" "}
              {resendAll ? "Everyone gets it, including those who already received it." : "Those who already received it are skipped."} This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending || !confirm?.count}
              onClick={() =>
                startTransition(async () => {
                  const outcome = await startEmailSendAction(emailId, resendAll);
                  setConfirm(null);
                  setResult(outcome);
                  setProgress(await emailProgressAction(emailId));
                })
              }
            >
              Send to {confirm?.count ?? 0}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
