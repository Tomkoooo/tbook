"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { claimDeviceLinkAction } from "../login-request-actions";

export function ClaimButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            // On success the action redirects, so a result only ever means failure.
            const result = await claimDeviceLinkAction(token);
            if (result && !result.ok) setError(result.message);
          })
        }
      >
        Sign in
      </Button>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
