"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CheckboxField, FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { ImageManager } from "@/components/image-manager";
import { deleteStandProductAction, saveStandProductAction, type StandResult } from "../actions";

export interface StandProductDto {
  id: string;
  name: string;
  category: "drink" | "food";
  priceHuf: number;
  depositHuf: number;
  costHuf: number | null;
  image: string;
  active: boolean;
}

/** Create or edit a stand product in a dialog. */
export function ProductEditor({ eventId, product }: { eventId: string; product: StandProductDto | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "drink");
  const [price, setPrice] = useState(String(product?.priceHuf ?? ""));
  const [deposit, setDeposit] = useState(String(product?.depositHuf ?? 0));
  const [cost, setCost] = useState(product?.costHuf === null || product?.costHuf === undefined ? "" : String(product.costHuf));
  const [images, setImages] = useState<string[]>(product?.image ? [product.image] : []);
  const [active, setActive] = useState(product?.active ?? true);
  const [result, setResult] = useState<StandResult | null>(null);
  const [pending, start] = useTransition();

  const priceN = Number(price) || 0;
  const depositN = Number(deposit) || 0;
  const profit = cost === "" ? null : priceN - depositN - Number(cost);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {product ? (
          <Button variant="outline" size="sm">
            Szerkesztés
          </Button>
        ) : (
          <Button>
            <Plus /> Új termék
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? product.name : "Új termék"}</DialogTitle>
          <DialogDescription>Az árak bruttó forintban értendők, a visszaváltási érték az árban benne van.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField label="Név">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Fajta">
            <NativeSelect value={category} onChange={(e) => setCategory(e.target.value as "drink" | "food")}>
              <option value="drink">Ital</option>
              <option value="food">Étel</option>
            </NativeSelect>
          </FormField>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Eladási ár (Ft)">
              <Input type="number" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
            </FormField>
            <FormField label="Visszaváltási érték (Ft)" hint="Pl. doboz: 50. Az árban benne van, nem nyereség.">
              <Input type="number" inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </FormField>
            <FormField label="Beszerzési ár (Ft)" hint="Opcionális, visszaváltási érték nélkül.">
              <Input type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
            </FormField>
          </div>
          {profit !== null ? <p className="text-muted-foreground text-sm">Haszon darabonként: {profit.toLocaleString("hu-HU")} Ft</p> : null}
          <FormField label="Kép">
            <ImageManager images={images} onChange={setImages} max={1} />
          </FormField>
          {product ? <CheckboxField label="Aktív (megjelenik a pulton)" checked={active} onCheckedChange={setActive} /> : null}
          <ResultNotice result={result} />
        </div>
        <DialogFooter>
          {product ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteStandProductAction(eventId, product.id);
                  setResult(r);
                  if (r.ok) {
                    setOpen(false);
                    router.refresh();
                  }
                })
              }
            >
              Törlés
            </Button>
          ) : null}
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveStandProductAction(eventId, product?.id ?? null, {
                  name,
                  category,
                  priceHuf: priceN,
                  depositHuf: depositN,
                  costHuf: cost === "" ? null : Number(cost),
                  image: images[0] ?? "",
                  active,
                });
                setResult(r);
                if (r.ok) {
                  setOpen(false);
                  router.refresh();
                }
              })
            }
          >
            Mentés
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
