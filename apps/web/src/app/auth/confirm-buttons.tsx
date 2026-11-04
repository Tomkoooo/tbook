"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmLoginRequestAction, denyLoginRequestAction } from "./login-request-actions";

/** Approve/decline a pending LoginRequest — shared by the QR-confirm and switch-device "sign in on the other device" screens. */
export function ConfirmButtons({
  token,
  approveLabel = "Approve",
  declineLabel = "Decline",
  approvedMessage = "Done — continue on the other device.",
  declinedMessage = "Declined.",
}: {
  token: string;
  approveLabel?: string;
  declineLabel?: string;
  approvedMessage?: string;
  declinedMessage?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (done === "approved") return <p className="text-muted-foreground text-sm">{approvedMessage}</p>;
  if (done === "denied") return <p className="text-muted-foreground text-sm">{declinedMessage}</p>;

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await confirmLoginRequestAction(token);
              if (result.ok) setError(null);
              else setError(result.message ?? "Something went wrong.");
              setDone(result.ok ? "approved" : null);
            })
          }
        >
          <CheckCircle2 /> {approveLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await denyLoginRequestAction(token);
              setDone("denied");
            })
          }
        >
          <XCircle /> {declineLabel}
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
