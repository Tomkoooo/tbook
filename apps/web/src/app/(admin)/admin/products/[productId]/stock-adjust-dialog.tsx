"use client";

import { useActionState, useState } from "react";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormField, ResultNotice } from "@/components/form-bits";
import { adjustStockAction, type ProductActionResult } from "../../product-actions";

/** Goods in / stock count / write-off for one variant. Every change is logged. */
export function StockAdjustDialog({ sku, label, onHand, reserved }: { sku: string; label: string; onHand: number; reserved: number }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"delta" | "set">("delta");
  const [state, action, pending] = useActionState(async (_prev: ProductActionResult | null, formData: FormData) => {
    const result = await adjustStockAction(formData);
    if (result.ok) setOpen(false);
    return result;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <PackagePlus /> Adjust
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Stock for {label} <span className="text-muted-foreground font-mono text-sm">{sku}</span>
          </DialogTitle>
          <DialogDescription>
            {onHand} on hand{reserved > 0 ? `, ${reserved} reserved by open webshop checkouts` : ""}.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="sku" value={sku} />
          <input type="hidden" name="mode" value={mode} />
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "delta" | "set")} className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem id={`${sku}-delta`} value="delta" />
              <Label htmlFor={`${sku}-delta`} className="cursor-pointer font-normal">
                Add or remove (e.g. +20 delivery, −1 damaged)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id={`${sku}-set`} value="set" />
              <Label htmlFor={`${sku}-set`} className="cursor-pointer font-normal">
                Set the counted total
              </Label>
            </div>
          </RadioGroup>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <FormField label={mode === "set" ? "On hand" : "Change"} htmlFor={`${sku}-amount`}>
              <Input id={`${sku}-amount`} name="amount" type="number" required min={mode === "set" ? reserved : undefined} placeholder={mode === "set" ? String(onHand) : "+20"} />
            </FormField>
            <FormField label="Reason" htmlFor={`${sku}-reason`}>
              <Input id={`${sku}-reason`} name="reason" placeholder="Delivery from supplier" />
            </FormField>
          </div>
          <ResultNotice result={state && !state.ok ? state : null} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save stock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
