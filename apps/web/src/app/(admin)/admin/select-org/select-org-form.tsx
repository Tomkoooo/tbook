"use client";

import { useActionState } from "react";
import { Button, Notice } from "@tbook/ui";
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
    <form action={action} className="tbook-stack">
      {state && !state.ok ? <Notice tone="danger">{state.message}</Notice> : null}

      {organizations.map((org) => (
        <div key={org.id} className="tbook-row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>{org.name}</strong>
            <div className="tbook-faint">{org.slug}</div>
          </div>
          <Button type="submit" name="organizationId" value={org.id} disabled={pending}>
            {pending ? "Opening…" : "Open"}
          </Button>
        </div>
      ))}
    </form>
  );
}
