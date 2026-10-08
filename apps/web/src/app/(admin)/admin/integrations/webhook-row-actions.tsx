"use client";

import { useActionState } from "react";
import { deleteWebhookAction, testWebhookAction, type ActionResult } from "../actions";

/**
 * Per-endpoint test and remove. Separate action states so a failing test
 * delivery reports next to the row it belongs to.
 */
export function WebhookRowActions({ webhookId }: { webhookId: string }) {
  const [testState, test, testing] = useActionState(
    async (): Promise<ActionResult> => testWebhookAction(webhookId),
    null,
  );
  const [deleteState, remove, removing] = useActionState(
    async (): Promise<ActionResult> => deleteWebhookAction(webhookId),
    null,
  );

  const notice = testState ?? deleteState;

  return (
    <div className="tbook-row">
      <form action={test}>
        <button type="submit" className="tbook-btn tbook-btn-secondary tbook-btn-sm" disabled={testing}>
          {testing ? "Sending…" : "Send test"}
        </button>
      </form>
      <form action={remove}>
        <button type="submit" className="tbook-btn tbook-btn-danger tbook-btn-sm" disabled={removing}>
          {removing ? "Removing…" : "Remove"}
        </button>
      </form>
      {notice?.message ? (
        <span className={notice.ok ? "tbook-faint" : "tbook-field-error"}>{notice.message}</span>
      ) : null}
    </div>
  );
}
