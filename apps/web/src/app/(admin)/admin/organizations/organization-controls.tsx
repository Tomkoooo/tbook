"use client";

import { useActionState, useState } from "react";
import { Ban, Copy, LogIn, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxField, FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import {
  createOrganizationAction,
  openOrganizationAction,
  setOrganizationStatusAction,
  type SettingsActionResult,
} from "../settings-actions";

export function CreateOrganizationForm() {
  const [makeMeOwner, setMakeMeOwner] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState(async (_prev: SettingsActionResult | null, formData: FormData) => {
    const result = await createOrganizationAction(formData);
    if (result.ok && !result.inviteUrl) setFormKey((key) => key + 1);
    return result;
  }, null);

  return (
    <SectionCard
      title="New organization"
      description="Creates the organization with Owner and Viewer roles. The owner gets an email invite, or you can make yourself the owner."
    >
      <form key={formKey} action={action} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <FormField label="Name" htmlFor="org-name">
            <Input id="org-name" name="name" required placeholder="Magyar Darts Szövetség" />
          </FormField>
          <FormField label="Currency" htmlFor="org-currency">
            <NativeSelect id="org-currency" name="currency" defaultValue="HUF">
              <option value="HUF">HUF</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </NativeSelect>
          </FormField>
        </div>
        <CheckboxField name="makeMeOwner" label="Make me the owner" checked={makeMeOwner} onCheckedChange={setMakeMeOwner} />
        {!makeMeOwner ? (
          <FormField label="Owner's email" htmlFor="org-owner" hint="Optional. They receive an invite and become Owner when they accept.">
            <Input id="org-owner" name="ownerEmail" type="email" placeholder="elnok@pelda.hu" className="max-w-md" />
          </FormField>
        ) : null}
        {state?.inviteUrl ? (
          <Notice tone="warning">
            {state.message}
            <span className="mt-2 flex items-center gap-2">
              <code className="bg-background rounded px-2 py-1 font-mono text-xs break-all">{state.inviteUrl}</code>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Copy invite link"
                onClick={() => navigator.clipboard?.writeText(state.inviteUrl ?? "")}
              >
                <Copy />
              </Button>
            </span>
          </Notice>
        ) : (
          <ResultNotice result={state} />
        )}
        <div>
          <Button type="submit" disabled={pending}>
            <Plus /> {pending ? "Creating…" : "Create organization"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

export function OrganizationRowActions({
  organizationId,
  status,
  isCurrent,
}: {
  organizationId: string;
  status: "active" | "suspended";
  isCurrent: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [opened, open, opening] = useActionState(async () => openOrganizationAction(organizationId), null);
  const [changed, change, changing] = useActionState(
    async () => setOrganizationStatusAction(organizationId, status === "active" ? "suspended" : "active"),
    null,
  );
  const error = [opened, changed].find((result) => result && !result.ok);

  return (
    <div className="flex items-center justify-end gap-1">
      {error ? <span className="text-destructive text-xs">{error.message}</span> : null}
      {status === "active" && !isCurrent ? (
        <form action={open}>
          <Button type="submit" variant="outline" size="sm" disabled={opening}>
            <LogIn /> Open
          </Button>
        </form>
      ) : null}
      {status === "suspended" ? (
        <form action={change}>
          <Button type="submit" variant="ghost" size="sm" disabled={changing}>
            <RotateCcw /> Reactivate
          </Button>
        </form>
      ) : confirming ? (
        <form action={change} className="flex items-center gap-1">
          <Button type="submit" variant="destructive" size="sm" disabled={changing}>
            {changing ? "Suspending…" : "Confirm suspend"}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={() => setConfirming(false)}>
            <X />
          </Button>
        </form>
      ) : (
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
          <Ban /> Suspend
        </Button>
      )}
    </div>
  );
}
