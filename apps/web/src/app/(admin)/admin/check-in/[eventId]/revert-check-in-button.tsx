"use client";

import { useActionState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revertCheckInAction, type ActionResult } from "../../actions";

/** Per-row undo. Supervisor-only (voucher:manage) — the server action re-checks that. */
export function RevertCheckInButton({ eventId, voucherId }: { eventId: string; voucherId: string }) {
  const [state, action, pending] = useActionState(
    async (): Promise<ActionResult> => revertCheckInAction(eventId, voucherId),
    null,
  );

  return (
    <form action={action} className="flex items-center justify-end gap-2">
      {state && !state.ok ? <span className="text-destructive text-xs">{state.message}</span> : null}
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        <Undo2 /> {pending ? "Undoing…" : "Undo"}
      </Button>
    </form>
  );
}
