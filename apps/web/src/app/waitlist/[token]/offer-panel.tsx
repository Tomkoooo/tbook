"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { acceptOfferAction, declineOfferAction, type OfferActionResult } from "./actions";

export function OfferPanel({ token }: { token: string }) {
  const [result, setResult] = useState<OfferActionResult | null>(null);
  const [pending, start] = useTransition();

  if (result?.ok) {
    if (result.checkoutUrl) {
      return (
        <Button asChild size="lg">
          <a href={result.checkoutUrl}>Tovább a fizetéshez</a>
        </Button>
      );
    }
    return (
      <div className="grid gap-1">
        <p className="font-medium">{result.message}</p>
        {result.registrationNumber ? <p className="font-mono text-lg">{result.registrationNumber}</p> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button size="lg" disabled={pending} onClick={() => start(async () => setResult(await acceptOfferAction(token)))}>
          Kérem a helyet
        </Button>
        <Button size="lg" variant="outline" disabled={pending} onClick={() => start(async () => setResult(await declineOfferAction(token)))}>
          Mégsem kérem
        </Button>
      </div>
      {result && !result.ok ? (
        <p className="text-destructive text-sm" role="alert">
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
