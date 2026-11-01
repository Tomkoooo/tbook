"use client";

import { useId, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/** Label + control + hint, the unit every catalog form is built from. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`grid content-start gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * shadcn Checkbox + label that submits through FormData like a native
 * checkbox (`name=on` when ticked, absent when not). The hidden input is
 * explicit so form actions never depend on Radix's internal bubble input.
 * Pass `checked`/`onCheckedChange` to control it, or `defaultChecked` not to.
 */
export function CheckboxField({
  name,
  value: submitValue = "on",
  label,
  hint,
  defaultChecked,
  checked,
  onCheckedChange,
  disabled,
}: {
  name?: string;
  /** Submitted value when ticked; give each box in a same-name group its own. */
  value?: string;
  label: ReactNode;
  hint?: ReactNode;
  defaultChecked?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [own, setOwn] = useState(defaultChecked ?? false);
  const value = checked ?? own;
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={value}
        disabled={disabled}
        className="mt-0.5"
        onCheckedChange={(next) => {
          setOwn(next === true);
          onCheckedChange?.(next === true);
        }}
      />
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="cursor-pointer leading-5 font-normal">
          {label}
        </Label>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>
      {name && value ? <input type="hidden" name={name} value={submitValue} /> : null}
    </div>
  );
}

/** Inline result banner for useActionState forms. */
export function ResultNotice({ result }: { result: { ok: boolean; message?: string } | null }) {
  if (!result?.message) return null;
  return (
    <Alert variant={result.ok ? "default" : "destructive"}>
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  );
}

/** One-time secret display (API key); it can't be recovered after the page is left. */
export function SecretNotice({ label, value }: { label: string; value: string }) {
  return (
    <Alert>
      <AlertDescription>
        <strong>{label}</strong>
        <code className="bg-muted mt-1 block rounded px-2 py-1 text-xs break-all">{value}</code>
      </AlertDescription>
    </Alert>
  );
}

/** Native select styled like the shadcn Input — submits through FormData with no client state. */
export function NativeSelect({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full min-w-0 cursor-pointer rounded-md border px-3 text-base shadow-xs outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:ring-[3px] ${className ?? ""}`}
      {...props}
    />
  );
}

export const STATUS_OPTIONS = [
  { value: "draft", label: "Draft (hidden)" },
  { value: "active", label: "Active (on sale)" },
  { value: "archived", label: "Archived" },
];

export function StatusSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <NativeSelect id="status" name="status" defaultValue={defaultValue}>
      {STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}
