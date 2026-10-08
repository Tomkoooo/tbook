"use client";

import { useActionState } from "react";
import { Button, Card, Field, Input, Notice } from "@tbook/ui";
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
    <Card title="Add an endpoint">
      {state?.message ? <Notice tone={state.ok ? "success" : "danger"}>{state.message}</Notice> : null}

      {state?.secret ? (
        <div className="tbook-notice tbook-notice-warning" style={{ marginTop: 12 }}>
          <strong>Signing secret — copy it now:</strong>
          <br />
          <code style={{ wordBreak: "break-all" }}>{state.secret}</code>
        </div>
      ) : null}

      <form action={action} className="tbook-stack" style={{ marginTop: 12 }}>
        <Field label="Endpoint URL" htmlFor="url" hint="Where the POST is sent. Use HTTPS in production.">
          <Input id="url" name="url" type="url" required placeholder="https://hooks.example.com/tbook" />
        </Field>

        <Field label="Description" htmlFor="description" hint="Optional — what this endpoint is for.">
          <Input id="description" name="description" placeholder="Zapier → Google Sheets" />
        </Field>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="tbook-field-label">Events</legend>
          <div className="tbook-row">
            {eventTypes.map((event) => (
              <label key={event} className="tbook-row" style={{ gap: 4 }}>
                <input type="checkbox" name="events" value={event} defaultChecked={event === "booking.paid"} />
                <code>{event}</code>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="tbook-row" style={{ gap: 6 }}>
          <input type="checkbox" name="enabled" defaultChecked />
          <span>Enabled</span>
        </label>

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add endpoint"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
