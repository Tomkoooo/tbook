"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { SectionCard } from "@/components/section-card";
import { saveGeneralSettingsAction, type SettingsActionResult } from "../settings-actions";

/** Currencies the payment and invoicing integrations handle (Számlázz.hu: HUF, EUR). */
const CURRENCIES = [
  { value: "HUF", label: "HUF — Hungarian forint" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "USD", label: "USD — US dollar (no Számlázz.hu invoices)" },
  { value: "GBP", label: "GBP — British pound (no Számlázz.hu invoices)" },
];

export function GeneralSettingsForm({ name, slug, currency }: { name: string; slug: string; currency: string }) {
  const [state, action, pending] = useActionState(
    async (_prev: SettingsActionResult | null, formData: FormData) => saveGeneralSettingsAction(formData),
    null,
  );
  const options = CURRENCIES.some((c) => c.value === currency) ? CURRENCIES : [{ value: currency, label: currency }, ...CURRENCIES];

  return (
    <SectionCard title="Organization" description="How the organization appears in the console and in customer emails.">
      <form action={action} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="name">
            <Input id="name" name="name" defaultValue={name} required />
          </FormField>
          <FormField label="Identifier" htmlFor="slug" hint="Used in links and the API. Can't be changed.">
            <Input id="slug" value={slug} readOnly disabled className="font-mono" />
          </FormField>
          <FormField
            label="Default currency"
            htmlFor="currency"
            hint="Used for new events. Existing events keep their own currency."
          >
            <NativeSelect id="currency" name="currency" defaultValue={currency}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        <ResultNotice result={state} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
