"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Values as chips: type and press Enter (or comma) to add, Backspace on an
 * empty field or the × to remove. Pasting "S, M, L" adds all three.
 * Duplicates (case-insensitive) are ignored.
 */
export function TagInput({
  id,
  values,
  onChange,
  placeholder,
  disabled,
}: {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const incoming = raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const next = [...values];
    for (const value of incoming) {
      if (!next.some((v) => v.toLowerCase() === value.toLowerCase())) next.push(value);
    }
    if (next.length !== values.length) onChange(next);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "border-input bg-background focus-within:border-ring focus-within:ring-ring/50 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 shadow-xs focus-within:ring-[3px]",
        disabled && "opacity-50",
      )}
    >
      {values.map((value) => (
        <span key={value} className="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-md py-0.5 pr-1 pl-2 text-sm">
          {value}
          {disabled ? null : (
            <button
              type="button"
              aria-label={`Remove ${value}`}
              className="hover:bg-background rounded p-0.5"
              onClick={() => onChange(values.filter((v) => v !== value))}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        value={draft}
        disabled={disabled}
        placeholder={values.length === 0 ? placeholder : "Add…"}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
        className="placeholder:text-muted-foreground min-w-20 flex-1 bg-transparent text-base outline-none md:text-sm"
      />
    </div>
  );
}
