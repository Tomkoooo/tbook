"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/tag-input";
import { cancelGuestAction, setGuestTagsAction } from "./guest-actions";

/** Tags and a two-step "cancel this guest" for one attendee row. */
export function GuestControls({
  bookingId,
  attendeeIndex,
  tags,
  canCancel,
}: {
  bookingId: string;
  attendeeIndex: number;
  tags: string[];
  canCancel: boolean;
}) {
  const [values, setValues] = useState(tags);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = values.join("\u0000") !== tags.join("\u0000");

  return (
    <div className="mt-2 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <TagInput values={values} onChange={setValues} placeholder="Add tag (VIP, Press, …)" disabled={pending} />
        </div>
        {dirty ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await setGuestTagsAction(bookingId, attendeeIndex, values);
                setMessage(result.message ?? null);
              })
            }
          >
            Save tags
          </Button>
        ) : null}
        {canCancel && !confirming ? (
          <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => setConfirming(true)}>
            Cancel guest
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="max-w-xs" />
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await cancelGuestAction(bookingId, attendeeIndex, reason);
                setMessage(result.message ?? null);
                setConfirming(false);
              })
            }
          >
            Confirm cancel
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : null}
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
