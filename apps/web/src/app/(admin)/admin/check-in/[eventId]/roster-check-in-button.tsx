"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkInFromRosterAction, type ScanActionResult } from "../../actions";

/** One tap admits a guest found by name or registration number (no QR at hand). */
export function RosterCheckInButton({ eventId, voucherId }: { eventId: string; voucherId: string }) {
  const [state, action, pending] = useActionState(async (): Promise<ScanActionResult> => checkInFromRosterAction(eventId, voucherId), null);
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      {state && !state.ok ? <span className="text-destructive text-xs">{state.message}</span> : null}
      <Button type="submit" size="sm" disabled={pending}>
        <LogIn /> {pending ? "…" : "Check in"}
      </Button>
    </form>
  );
}
