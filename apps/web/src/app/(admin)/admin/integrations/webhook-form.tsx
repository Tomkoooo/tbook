"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxField, FormField, SecretNotice } from "@/components/form-bits";
import { Notice } from "@/components/notice";
import { SectionCard } from "@/components/section-card";
import { saveWebhookAction, type WebhookActionResult } from "../actions";

/**
 * Add-endpoint form. The created secret comes back exactly once, so it is
 * rendered prominently rather than tucked into a toast — it cannot be
 * recovered afterwards, only rotated by recreating the endpoint.
 */
export function WebhookForm({ eventTypes }: { eventTypes: string[] }) {
  const [state, action, pending] = useActionState(
    async (_prev: WebhookActionResult | null, formData: FormData) => saveWebhookAction(formData),
    null,
  );

  return (
    <SectionCard title="Add an endpoint">
      <form action={action} className="grid gap-4">
        {state?.message ? <Notice tone={state.ok ? "success" : "danger"}>{state.message}</Notice> : null}
        {state?.secret ? <SecretNotice label="Signing secret — copy it now:" value={state.secret} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Endpoint URL" htmlFor="url" hint="Where the POST is sent. Use HTTPS in production.">
            <Input id="url" name="url" type="url" required placeholder="https://hooks.example.com/tbook" />
          </FormField>
          <FormField label="Description" htmlFor="description" hint="Optional — what this endpoint is for.">
            <Input id="description" name="description" placeholder="Zapier → Google Sheets" />
          </FormField>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Events</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {eventTypes.map((event) => (
              <CheckboxField
                key={event}
                name="events"
                value={event}
                defaultChecked={event === "booking.paid"}
                label={<code className="font-mono text-xs">{event}</code>}
              />
            ))}
          </div>
        </fieldset>

        <CheckboxField name="enabled" defaultChecked label="Enabled" />

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add endpoint"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
