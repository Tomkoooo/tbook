"use client";

import { useActionState } from "react";
import { Building2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/notice";
import { selectOrganizationAction, type ActionResult } from "../actions";

/**
 * One submit button per org rather than a select + submit: with a handful
 * of orgs it is one click instead of two, and it degrades to plain form
 * posts without JS.
 */
export function SelectOrgForm({ organizations }: { organizations: Array<{ id: string; name: string; slug: string }> }) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => selectOrganizationAction(formData),
    null,
  );

  return (
    <form action={action}>
      {state && !state.ok ? (
        <div className="p-4">
          <Notice tone="danger">{state.message}</Notice>
        </div>
      ) : null}

      <ul className="divide-y">
        {organizations.map((org) => (
          <li key={org.id} className="flex items-center gap-3 px-5 py-3">
            <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
              <Building2 className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{org.name}</p>
              <p className="text-muted-foreground truncate font-mono text-xs">{org.slug}</p>
            </div>
            <Button type="submit" size="sm" name="organizationId" value={org.id} disabled={pending}>
              {pending ? "Opening…" : "Open"} <ChevronRight />
            </Button>
          </li>
        ))}
      </ul>
    </form>
  );
}
