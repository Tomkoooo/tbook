"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign-in declined</CardTitle>
          <CardDescription>The request was declined on the other device. Go back and try again.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state === "expired") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>This sign-in request expired</CardTitle>
          <CardDescription>Go back and start again.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="size-5 animate-spin" /> {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
