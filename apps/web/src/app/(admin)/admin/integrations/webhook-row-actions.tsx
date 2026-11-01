"use client";

import { useActionState } from "react";
import { Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-wrap items-center justify-end gap-2">
      {notice?.message ? (
        <span className={notice.ok ? "text-muted-foreground text-xs" : "text-destructive text-xs"}>{notice.message}</span>
      ) : null}
      <form action={test}>
        <Button type="submit" variant="outline" size="sm" disabled={testing}>
          <Send /> {testing ? "Sending…" : "Send test"}
        </Button>
      </form>
      <form action={remove}>
        <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={removing}>
          <Trash2 /> {removing ? "Removing…" : "Remove"}
        </Button>
      </form>
    </div>
  );
}
