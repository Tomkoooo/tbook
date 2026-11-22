"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/notice";
import { pollLoginRequestAction } from "./login-request-actions";

/**
 * Polls a pending LoginRequest and, once another device confirms it, lands
 * the freshly-issued session cookie here and navigates onward — same
 * setInterval-poll shape as admin/sales-actions.ts's pollCardSaleAction
 * (there's no push/WebSocket infra in this app, so polling is the existing
 * pattern for "wait for an external confirmation").
 */
export function LoginWaiting({ token, title, description }: { token: string; title: string; description: string }) {
  const [state, setState] = useState<"waiting" | "denied" | "expired">("waiting");

  useEffect(() => {
    let stopped = false;
    const timer = setInterval(async () => {
      let result;
      try {
        result = await pollLoginRequestAction(token);
      } catch {
        return; // transient error talking to the server — just retry on the next tick
      }
      if (stopped) return;
      if (result.status === "ready") {
        stopped = true;
        clearInterval(timer);
        window.location.href = result.redirectTo;
      } else if (result.status === "denied" || result.status === "expired") {
        stopped = true;
        clearInterval(timer);
        setState(result.status);
      }
    }, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [token]);

  if (state === "denied") {
    return (
      <div className="w-full max-w-sm">
        <Notice tone="danger" title="Sign-in declined">
          The request was declined on the other device. Go back and try again.
        </Notice>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="w-full max-w-sm">
        <Notice tone="warning" title="This sign-in request expired">
          Go back and start again.
        </Notice>
      </div>
    );
  }

  return (
    <Card className="w-full max-w-sm border-dashed shadow-none" role="status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Loader2 className="text-muted-foreground size-4 animate-spin" /> {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
