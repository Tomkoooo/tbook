"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { processWaitlistAction, removeWaitlistEntryAction } from "./actions";

export function ProcessWaitlistButton({ eventId }: { eventId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {message ? <span className="text-muted-foreground text-sm">{message}</span> : null}
      <Button variant="outline" disabled={pending} onClick={() => start(async () => setMessage((await processWaitlistAction(eventId)).message ?? null))}>
        Fill free places now
      </Button>
    </div>
  );
}

export function RemoveEntryButton({ entryId }: { entryId: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    );
  }
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => start(async () => void (await removeWaitlistEntryAction(entryId)))}>
        Confirm
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </div>
  );
}
