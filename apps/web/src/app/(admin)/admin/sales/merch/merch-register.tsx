"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, CreditCard, Minus, Package, Plus, Printer, RotateCcw, Trash2 } from "lucide-react";
import type { MerchSaleView, ProductView } from "@tbook/services";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField, ResultNotice } from "@/components/form-bits";
import { cn } from "@/lib/utils";
import { createMerchSaleAction, retryMerchReceiptAction, type ProductActionResult } from "../../product-actions";

interface CartLine {
  sku: string;
  name: string;
  label: string;
  unitPrice: number;
  quantity: number;
  /** What the shelf had when the page loaded; the server re-checks. */
  available: number;
}

/**
 * Counter merch sale for a tablet: tap a product (pick a size if it has
 * them), adjust quantities, take cash or a card on the myPOS terminal,
 * print the receipt. Stock comes from the shared warehouse.
 */
export function MerchRegister({ products, currency }: { products: ProductView[]; currency: string }) {
  const router = useRouter();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<ProductView | null>(null);
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [done, setDone] = useState<MerchSaleView | null>(null);
  const money = (n: number) => `${n.toLocaleString("hu-HU")} ${currency}`;
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

  function add(product: ProductView, variant: ProductView["variants"][number]) {
    setCart((current) => {
      const existing = current.find((line) => line.sku === variant.sku);
      if (existing) {
        return current.map((line) => (line.sku === variant.sku ? { ...line, quantity: Math.min(line.quantity + 1, line.available) } : line));
      }
      return [...current, { sku: variant.sku, name: product.name, label: variant.label, unitPrice: variant.priceGross, quantity: 1, available: variant.available }];
    });
    setPicking(null);
  }

  function tap(product: ProductView) {
    const sellable = product.variants.filter((v) => v.active);
    if (sellable.length === 1) add(product, sellable[0]!);
    else setPicking(product);
  }

  const setQty = (sku: string, quantity: number) =>
    setCart((current) =>
      current.flatMap((line) => (line.sku !== sku ? [line] : quantity <= 0 ? [] : [{ ...line, quantity: Math.min(quantity, line.available) }])),
    );

  const [state, action, pending] = useActionState(async (_prev: ProductActionResult | null, formData: FormData) => {
    const data = new FormData();
    data.set(
      "payload",
      JSON.stringify({
        lines: cart.map((line) => ({ sku: line.sku, quantity: line.quantity })),
        paymentMethod: method,
        paymentReference: String(formData.get("paymentReference") ?? ""),
      }),
    );
    const result = await createMerchSaleAction(data);
    if (result.ok && result.sale) {
      setDone(result.sale);
      setCart([]);
    }
    return result;
  }, null);

  if (done) {
    return (
      <SaleDone
        sale={done}
        money={money}
        onNewSale={() => {
          setDone(null);
          router.refresh(); // fresh stock counts
        }}
      />
    );
  }

  const sellable = products.filter((p) => p.variants.some((v) => v.active));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {sellable.length === 0 ? (
          <p className="text-muted-foreground col-span-full text-sm">No products on sale at the counter. Add them under Products.</p>
        ) : null}
        {sellable.map((product) => {
          const soldOut = product.totalAvailable === 0;
          const prices = product.variants.filter((v) => v.active).map((v) => v.priceGross);
          return (
            <button
              key={product.id}
              type="button"
              disabled={soldOut}
              onClick={() => tap(product)}
              className="bg-card hover:bg-muted flex flex-col overflow-hidden rounded-xl border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="bg-muted flex aspect-square w-full items-center justify-center">
                {product.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-entered external URLs
                  <img src={product.images[0]} alt="" className="size-full object-cover" />
                ) : (
                  <Package className="text-muted-foreground size-10" />
                )}
              </div>
              <div className="grid gap-0.5 p-3">
                <span className="line-clamp-2 text-sm font-semibold">{product.name}</span>
                <span className="text-sm tabular-nums">
                  {money(Math.min(...prices))}
                  {Math.max(...prices) !== Math.min(...prices) ? "+" : ""}
                </span>
                <span className={cn("text-xs", soldOut ? "text-danger" : "text-muted-foreground")}>
                  {soldOut ? "Sold out" : `${product.totalAvailable} in stock`}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <Card className="lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>Cart</CardTitle>
          <CardDescription>{cart.length === 0 ? "Tap a product to add it." : `${cart.reduce((s, l) => s + l.quantity, 0)} item(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {cart.length > 0 ? (
            <ul className="grid gap-2">
              {cart.map((line) => (
                <li key={line.sku} className="grid gap-1 rounded-lg border p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">
                      {line.name}
                      {line.label ? <span className="text-muted-foreground"> · {line.label}</span> : null}
                    </span>
                    <span className="text-sm tabular-nums">{money(line.unitPrice * line.quantity)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="icon" aria-label={`One less ${line.name}`} onClick={() => setQty(line.sku, line.quantity - 1)}>
                      {line.quantity === 1 ? <Trash2 /> : <Minus />}
                    </Button>
                    <span className="w-8 text-center tabular-nums">{line.quantity}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`One more ${line.name}`}
                      disabled={line.quantity >= line.available}
                      onClick={() => setQty(line.sku, line.quantity + 1)}
                    >
                      <Plus />
                    </Button>
                    {line.quantity >= line.available ? <span className="text-warning text-xs">last in stock</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-end justify-between border-t pt-3">
            <span className="text-muted-foreground text-sm">Total</span>
            <span className="text-3xl font-semibold tabular-nums">{money(total)}</span>
          </div>

          <form action={action} className="grid gap-3">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment method">
              {(
                [
                  { value: "cash", label: "Cash", icon: Banknote },
                  { value: "card", label: "Card (myPOS)", icon: CreditCard },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={method === value}
                  onClick={() => setMethod(value)}
                  className={cn(
                    "flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors",
                    method === value ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
            {method === "card" ? (
              <FormField label="Terminal slip no. (optional)" htmlFor="paymentReference" hint={`Key ${money(total)} into the myPOS terminal first.`}>
                <Input id="paymentReference" name="paymentReference" autoComplete="off" />
              </FormField>
            ) : null}
            <ResultNotice result={state && !state.ok ? state : null} />
            <Button type="submit" size="lg" className="h-14 text-base" disabled={pending || cart.length === 0}>
              {pending ? "Recording…" : `Paid ${money(total)} — make receipt`}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Dialog open={picking !== null} onOpenChange={(open) => !open && setPicking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{picking?.name}</DialogTitle>
            <DialogDescription>Pick the variant.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {picking?.variants
              .filter((v) => v.active)
              .map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  disabled={variant.available === 0}
                  onClick={() => add(picking, variant)}
                  className="hover:bg-muted grid gap-0.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="text-lg font-semibold">{variant.label || variant.sku}</span>
                  <span className="text-sm tabular-nums">{money(variant.priceGross)}</span>
                  <span className={cn("text-xs", variant.available === 0 ? "text-danger" : "text-muted-foreground")}>
                    {variant.available === 0 ? "sold out" : `${variant.available} left`}
                  </span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaleDone({ sale: initial, money, onNewSale }: { sale: MerchSaleView; money: (n: number) => string; onNewSale: () => void }) {
  const [sale, setSale] = useState(initial);
  const [retryState, retry, retrying] = useActionState(async () => {
    const result = await retryMerchReceiptAction(sale.id);
    if (result.sale) setSale(result.sale);
    return result;
  }, null);
  const issued = sale.receipt.status === "issued" && sale.receipt.hasPdf;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <CheckCircle2 className="text-success size-6" /> Paid — {money(sale.totalGross)}
        </CardTitle>
        <CardDescription>
          {sale.lines.map((l) => `${l.quantity}× ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""}`).join(", ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {issued ? (
          <div className="grid gap-2">
            <Button asChild size="lg" className="h-16 text-lg">
              <a href={`/admin/sales/merch/${sale.id}/receipt`} target="_blank" rel="noopener">
                <Printer className="size-6" /> Print receipt {sale.receipt.number}
              </a>
            </Button>
            <p className="text-muted-foreground text-xs">
              iPad: <strong>Share → Print</strong>. Android: <strong>⋮ → Share → Print</strong>.
            </p>
          </div>
        ) : (
          <>
            <Alert variant="destructive">
              <AlertTitle>No receipt yet</AlertTitle>
              <AlertDescription>{sale.receipt.error ?? "The receipt could not be issued."} The sale and the stock change are recorded.</AlertDescription>
            </Alert>
            <form action={retry}>
              <Button type="submit" variant="outline" size="lg" disabled={retrying}>
                <RotateCcw /> {retrying ? "Trying again…" : "Try the receipt again"}
              </Button>
            </form>
            {retryState && !retryState.ok && retryState.message !== sale.receipt.error ? <ResultNotice result={retryState} /> : null}
          </>
        )}
        <div className="border-t pt-4">
          <Button type="button" size="lg" variant="secondary" className="h-12" onClick={onNewSale}>
            <Plus /> New sale
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
