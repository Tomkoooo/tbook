"use client";

import { useActionState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryMerchReceiptAction } from "../../product-actions";

/** Retry from the recent-sales list, for a receipt that failed after the seller moved on. */
export function RetryReceiptButton({ saleId, error }: { saleId: string; error: string | null }) {
  const [state, action, pending] = useActionState(async () => retryMerchReceiptAction(saleId), null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={pending} title={error ?? undefined}>
        <RotateCcw /> {pending ? "Trying…" : "Retry receipt"}
      </Button>
      {state ? <span className={state.ok ? "text-success text-xs" : "text-destructive text-xs"}>{state.message}</span> : null}
    </form>
  );
}
