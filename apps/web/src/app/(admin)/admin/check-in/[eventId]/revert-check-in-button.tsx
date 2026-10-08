"use client";

import { useActionState } from "react";
import { revertCheckInAction, type ActionResult } from "../../actions";

/** Per-row undo. Supervisor-only (voucher:manage) — the server action re-checks that. */
export function RevertCheckInButton({ eventId, voucherId }: { eventId: string; voucherId: string }) {
  const [state, action, pending] = useActionState(
    async (): Promise<ActionResult> => revertCheckInAction(eventId, voucherId),
    null,
  );

  return (
    <form action={action}>
      <button type="submit" className="tbook-btn tbook-btn-ghost tbook-btn-sm" disabled={pending}>
        {pending ? "Undoing…" : "Undo"}
      </button>
      {state && !state.ok ? <span className="tbook-field-error">{state.message}</span> : null}
    </form>
  );
}
