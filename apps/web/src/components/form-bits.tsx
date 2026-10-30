"use client";

import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";

/** Label + control + hint, the unit every catalog form is built from. */
export function FormField({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
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
      className={`border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] ${className ?? ""}`}
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
