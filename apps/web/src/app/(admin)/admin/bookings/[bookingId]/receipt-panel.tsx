"use client";

import { useActionState } from "react";
import { Printer, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResultNotice } from "@/components/form-bits";
import { SectionCard } from "@/components/section-card";
import { retryReceiptAction } from "../../sales-actions";

/** Walk-in sale receipt: reprint it, or retry when Számlázz.hu failed. */
export function ReceiptPanel({
  bookingId,
  status,
  number,
  error,
  hasPdf,
}: {
  bookingId: string;
  status: string;
  number: string | null;
  error: string | null;
  hasPdf: boolean;
}) {
  const [state, retry, retrying] = useActionState(async () => retryReceiptAction(bookingId), null);
  const issued = status === "issued";

  return (
    <SectionCard
      title="Receipt (walk-in sale)"
      description="Nothing was emailed for this sale; the customer got a printed Számlázz.hu receipt."
      actions={<Badge variant={issued ? "success" : status === "failed" ? "danger" : "warning"}>{issued ? number : status}</Badge>}
    >
      <div className="grid gap-3">
        {!issued && error ? <p className="text-destructive text-sm">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {issued && hasPdf ? (
            <Button asChild>
              <a href={`/admin/bookings/${bookingId}/receipt`} target="_blank" rel="noopener">
                <Printer /> Print again
              </a>
            </Button>
          ) : null}
          {!issued ? (
            <form action={retry}>
              <Button type="submit" variant="outline" disabled={retrying}>
                <RotateCcw /> {retrying ? "Trying again…" : "Issue the receipt again"}
              </Button>
            </form>
          ) : null}
        </div>
        <ResultNotice result={state} />
      </div>
    </SectionCard>
  );
}
