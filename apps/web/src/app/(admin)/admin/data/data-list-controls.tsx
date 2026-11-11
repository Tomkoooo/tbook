"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ResultNotice } from "@/components/form-bits";
import { deleteDataListAction, type DataActionResult } from "../data-actions";

export function DeleteDataListButton({ listId, name }: { listId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<DataActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), setResult(null))}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Delete ${name}`}>
          <Trash2 />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>Its rows are deleted too. Lists used by a registration rule can’t be deleted.</DialogDescription>
        </DialogHeader>
        <ResultNotice result={result} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const outcome = await deleteDataListAction(listId);
                if (outcome.ok) setOpen(false);
                else setResult(outcome);
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
