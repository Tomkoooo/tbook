import type { ComponentPropsWithRef, ReactNode } from "react";

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

/** Label + control + hint/error, so every form row is wired for a11y the same way. */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="tbook-field">
      <label className="tbook-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="tbook-field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="tbook-field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * `ComponentPropsWithRef` rather than `InputHTMLAttributes` so callers can
 * pass a `ref` — React 19 treats ref as an ordinary prop, and the check-in
 * scanner needs one to re-focus the field after every scan.
 */
export function Input({ className, ...rest }: ComponentPropsWithRef<"input">) {
  return <input className={["tbook-input", className].filter(Boolean).join(" ")} {...rest} />;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends ComponentPropsWithRef<"select"> {
  options: SelectOption[];
  placeholder?: string;
}

/**
 * Native <select> rather than a Radix listbox. The console's selects are
 * plain single-choice filters, and a native control gets keyboard support,
 * mobile pickers and zero JS for free — a custom listbox here would be
 * cost without benefit.
 */
export function Select({ options, placeholder, className, ...rest }: SelectProps) {
  return (
    <select className={["tbook-input", "tbook-select", className].filter(Boolean).join(" ")} {...rest}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
