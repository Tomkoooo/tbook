"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CheckboxField, FormField, ResultNotice } from "@/components/form-bits";
import { appendDataListRowsAction, deleteDataListAction, deleteDataListRowAction, type ApplyResult, type DataActionResult } from "../data-actions";

export function DeleteDataListButton({ listId, name }: { listId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<DataActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), setResult(null))}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Delete ${name}`}>
          <Trash2 />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>Its rows are deleted too. Lists used by a registration rule can’t be deleted.</DialogDescription>
        </DialogHeader>
        <ResultNotice result={result} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const outcome = await deleteDataListAction(listId);
                if (outcome.ok) setOpen(false);
                else setResult(outcome);
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Add rows": one row through a field per column, or several pasted from Excel / Google Sheets. */
export function AddDataListRowsDialog({ listId, columns, keyColumn }: { listId: string; columns: Array<{ key: string; label: string }>; keyColumn: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"one" | "paste">("one");
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const keyLabel = columns.find((column) => column.key === keyColumn)?.label ?? keyColumn;
  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), setResult(null))}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add rows
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add rows</DialogTitle>
          <DialogDescription>Adds to the list without replacing it. Only {keyLabel} is required; registration checks see new rows right away.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={mode === "one" ? "default" : "outline"} onClick={() => setMode("one")}>
            One row
          </Button>
          <Button type="button" size="sm" variant={mode === "paste" ? "default" : "outline"} onClick={() => setMode("paste")}>
            Paste many
          </Button>
        </div>
        <form
          key={formKey}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            if (mode === "one") data.delete("paste");
            startTransition(async () => {
              const outcome = await appendDataListRowsAction(listId, data);
              setResult(outcome);
              if (outcome.ok) setFormKey((n) => n + 1);
            });
          }}
        >
          {mode === "one" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {columns.map((column, index) => (
                <FormField key={column.key} label={`${column.label}${column.key === keyColumn ? " *" : ""}`} htmlFor={`cell-${index}`}>
                  <Input id={`cell-${index}`} name={`cell:${column.key}`} required={column.key === keyColumn} autoFocus={column.key === keyColumn} />
                </FormField>
              ))}
            </div>
          ) : (
            <FormField
              label="Rows"
              htmlFor="paste-rows"
              hint={`Copy the rows from Excel and paste them here, one per line, columns in this order: ${columns.map((column) => column.label).join(" · ")}. Missing cells stay empty.`}
            >
              <Textarea id="paste-rows" name="paste" rows={8} className="font-mono text-xs" required />
            </FormField>
          )}
          <CheckboxField name="update" label="Update rows that already exist" hint={`Off: a ${keyLabel} already in the list is left as it is.`} />
          {result ? (
            <div className="grid gap-1">
              <ResultNotice result={result} />
              {result.details?.map((detail) => (
                <p key={detail} className="text-muted-foreground text-xs">
                  {detail}
                </p>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDataListRowButton({ listId, rowKey, label }: { listId: string; rowKey: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<DataActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), setResult(null))}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Remove ${label}`}>
          <X />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {label}?</DialogTitle>
          <DialogDescription>Only this row is removed. Someone who already registered stays registered.</DialogDescription>
        </DialogHeader>
        <ResultNotice result={result} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const outcome = await deleteDataListRowAction(listId, rowKey);
                if (outcome.ok) setOpen(false);
                else setResult(outcome);
              })
            }
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
