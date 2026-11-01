import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-bits";

/**
 * Password-style input for a stored secret. The secret itself is never
 * sent to the browser — only whether one is saved and a short hint — and
 * leaving the field empty keeps the saved value.
 */
export function SecretField({
  id,
  label,
  saved,
  hint,
  placeholder,
}: {
  id: string;
  label: string;
  saved: { configured: boolean; hint: string };
  hint?: string;
  placeholder?: string;
}) {
  return (
    <FormField
      label={label}
      htmlFor={id}
      hint={saved.configured ? `Saved (${saved.hint}). Leave empty to keep it.` : hint}
    >
      <Input
        id={id}
        name={id}
        type="password"
        autoComplete="off"
        placeholder={saved.configured ? "••••••••" : placeholder}
      />
    </FormField>
  );
}
