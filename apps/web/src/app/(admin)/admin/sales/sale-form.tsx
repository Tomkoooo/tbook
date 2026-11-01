"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, CreditCard, Loader2, Mail, Minus, Plus, Printer, ReceiptText, RotateCcw } from "lucide-react";
import type { AttendeeFieldDef } from "@tbook/schemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { AttendeeFields } from "../bookings/new/attendee-fields";
import type { PosSaleResult } from "@tbook/services";
import {
  cancelCardSaleAction,
  createPosSaleAction,
  pollCardSaleAction,
  retryReceiptAction,
  startCardSaleAction,
  type PosSaleActionResult,
} from "../sales-actions";

const METHODS = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "card", label: "Card", icon: CreditCard },
] as const;

const DELIVERIES = [
  { value: "receipt", label: "Walk-in · printed receipt", hint: "No email. Pays, gets a receipt, goes straight in.", icon: ReceiptText },
  { value: "email", label: "Email ticket + invoice", hint: "Customer details and billing address needed.", icon: Mail },
] as const;
type Delivery = (typeof DELIVERIES)[number]["value"];

/** The counter tablet keeps the last mode the seller used. */
function useDelivery(): [Delivery, (next: Delivery) => void] {
  const [delivery, setDelivery] = useState<Delivery>("email");
  useEffect(() => {
    const saved = window.localStorage.getItem("tbook.pos.delivery");
    if (saved === "receipt" || saved === "email") setDelivery(saved);
  }, []);
  return [
    delivery,
    (next) => {
      setDelivery(next);
      window.localStorage.setItem("tbook.pos.delivery", next);
    },
  ];
}

export interface DayOption {
  date: string;
  weekend: boolean;
  unitPriceGrossHuf: number;
  remaining: number | null;
  bookable: boolean;
}

export function SaleForm({
  event,
  tickets: ticketsFromUrl,
  dayOptions,
  currency,
  total: totalFromServer,
  attendeeFields,
  teamMemberFields,
  readers,
}: {
  readers: Array<{ id: string; name: string }>;
  event: { id: string; teamMemberLimit: number | null; playersPerTicket: number };
  tickets: number;
  /** Present for day-pass events: the days a seller can put in the basket. */
  dayOptions: DayOption[] | null;
  currency: string;
  total: number;
  attendeeFields: AttendeeFieldDef[];
  teamMemberFields: AttendeeFieldDef[];
}) {
  const router = useRouter();
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [delivery, setDelivery] = useDelivery();
  const walkIn = delivery === "receipt";
  const [company, setCompany] = useState(false);
  // The action's result outlives the success panel, so "New sale" dismisses
  // that specific sale instead of trying to reset the action state.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [basket, setBasket] = useState<Record<string, number>>({});

  // A day-pass sale is sized by its basket; any other sale by the stepper.
  const tickets = dayOptions ? Object.values(basket).reduce((sum, qty) => sum + qty, 0) : ticketsFromUrl;
  // Display only — the server recomputes the price from the basket.
  const total = dayOptions
    ? dayOptions.reduce((sum, day) => sum + (basket[day.date] ?? 0) * day.unitPriceGrossHuf, 0)
    : totalFromServer;

  function setDayQty(day: DayOption, qty: number) {
    const max = day.remaining ?? 50;
    setBasket((current) => {
      const next = { ...current };
      const clamped = Math.min(Math.max(qty, 0), max);
      if (clamped === 0) delete next[day.date];
      else next[day.date] = clamped;
      return next;
    });
  }
  // "reader" pushes the amount to a SumUp Solo; "manual" records a card the seller took some other way.
  const [cardMode, setCardMode] = useState<"reader" | "manual">(readers.length > 0 ? "reader" : "manual");
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [paidSale, setPaidSale] = useState<PosSaleResult | null>(null);
  const [cardMessage, setCardMessage] = useState<string | null>(null);

  const [state, action, pending] = useActionState(async (_prev: PosSaleActionResult | null, formData: FormData) => {
    if (method === "card" && cardMode === "reader") {
      setCardMessage(null);
      const started = await startCardSaleAction(formData);
      if (started.ok && started.bookingId) setWaitingFor(started.bookingId);
      return started.ok ? null : { ok: false, message: started.message };
    }
    return createPosSaleAction(formData);
  }, null);

  function finishCardSale(result: { state?: string; sale?: PosSaleResult; message?: string }) {
    if (result.state === "paid" && result.sale) {
      setPaidSale(result.sale);
      setWaitingFor(null);
    } else if (result.state && result.state !== "waiting") {
      // Declined, cancelled or mismatched: back to the form, which kept everything typed.
      setCardMessage(result.message ?? "The card payment did not go through.");
      setWaitingFor(null);
    }
  }

  const isTeam = teamMemberFields.length > 0;
  const rosterSize = event.playersPerTicket > 1 ? event.playersPerTicket : null;
  const money = (amount: number) => `${amount.toLocaleString("hu-HU")} ${currency}`;

  const completedSale = paidSale ?? (state?.ok ? (state.sale ?? null) : null);
  if (completedSale && completedSale.bookingId !== dismissedId) {
    return <SaleComplete sale={completedSale} money={money} onNewSale={() => setDismissedId(completedSale.bookingId)} />;
  }

  return (
    <>
      {waitingFor ? <CardWaiting bookingId={waitingFor} total={money(total)} onResult={finishCardSale} /> : null}
    <form action={action} className={cn("grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start", waitingFor && "hidden")}>
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="paymentMethod" value={method} />
      <input type="hidden" name="delivery" value={delivery} />

      <div className="grid content-start gap-6">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="What the customer gets">
        {DELIVERIES.map(({ value, label, hint, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={delivery === value}
            onClick={() => setDelivery(value)}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              delivery === value ? "border-primary bg-accent text-accent-foreground ring-primary/30 ring-2" : "bg-card hover:bg-muted",
            )}
          >
            <Icon className="mt-0.5 size-6 shrink-0" />
            <span className="grid gap-0.5">
              <span className="text-base font-semibold">{label}</span>
              <span className="text-muted-foreground text-xs">{hint}</span>
            </span>
          </button>
        ))}
      </div>
      <input type="hidden" name="tickets" value={Math.max(tickets, 1)} />
      {dayOptions ? <input type="hidden" name="dayPasses" value={JSON.stringify(basket)} /> : null}

      {dayOptions ? (
        <Card>
          <CardHeader>
            <CardTitle>Days</CardTitle>
            <CardDescription>Choose how many passes for each day.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {dayOptions.map((day) => {
              const qty = basket[day.date] ?? 0;
              return (
                <div
                  key={day.date}
                  className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", !day.bookable && "opacity-50", qty > 0 && "border-primary bg-accent")}
                >
                  <div>
                    <p className="text-sm font-medium tabular-nums">
                      {day.date}{" "}
                      <span className="text-muted-foreground font-normal">
                        {new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}
                        {day.weekend ? " · weekend" : ""}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {money(day.unitPriceGrossHuf)} ·{" "}
                      {!day.bookable ? "not available" : day.remaining === null ? "no limit" : `${day.remaining} left`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="icon" aria-label={`Fewer passes for ${day.date}`} disabled={qty === 0} onClick={() => setDayQty(day, qty - 1)}>
                      <Minus />
                    </Button>
                    <span className="w-6 text-center tabular-nums">{qty}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`More passes for ${day.date}`}
                      disabled={!day.bookable || (day.remaining !== null && qty >= day.remaining)}
                      onClick={() => setDayQty(day, qty + 1)}
                    >
                      <Plus />
                    </Button>
                  </div>
                </div>
              );
            })}
            <div className="mt-2 flex items-end justify-between md:col-span-2">
              <p className="text-muted-foreground text-sm">{tickets} pass{tickets === 1 ? "" : "es"}</p>
              <div className="text-right">
                <p className="text-muted-foreground text-xs">Total to collect</p>
                <p className="text-3xl font-semibold tabular-nums">{money(total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle>{isTeam ? "Teams" : "Tickets"}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Fewer tickets"
              disabled={tickets <= 1}
              onClick={() => router.replace(`/admin/sales?eventId=${event.id}&tickets=${tickets - 1}`)}
            >
              <Minus />
            </Button>
            <span className="w-10 text-center text-xl font-semibold tabular-nums">{tickets}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="More tickets"
              disabled={tickets >= 50}
              onClick={() => router.replace(`/admin/sales?eventId=${event.id}&tickets=${tickets + 1}`)}
            >
              <Plus />
            </Button>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground text-xs">Total to collect</p>
            <p className="text-3xl font-semibold tabular-nums">{money(total)}</p>
          </div>
        </CardContent>
      </Card>
      )}

      {walkIn ? (
        <Card>
          <CardContent className="grid gap-2">
            <FormField label="Name (optional)" htmlFor="customer.name" hint="Only for your records — nothing is sent to the customer.">
              <Input id="customer.name" name="customer.name" autoComplete="off" placeholder="Walk-in customer" className="max-w-md" />
            </FormField>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
          <CardDescription>The ticket and invoice are emailed to this address.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <FormField label="Name" htmlFor="customer.name">
            <Input id="customer.name" name="customer.name" required autoComplete="off" />
          </FormField>
          <FormField label="Email" htmlFor="customer.email">
            <Input id="customer.email" name="customer.email" type="email" required autoComplete="off" />
          </FormField>
          <FormField label="Phone" htmlFor="customer.phone">
            <Input id="customer.phone" name="customer.phone" required autoComplete="off" />
          </FormField>
        </CardContent>
      </Card>
      )}

      {attendeeFields.length > 0 || isTeam ? (
        <Card>
          <CardHeader>
            <CardTitle>{isTeam ? "Players" : "Attendees"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {Array.from({ length: tickets }, (_, index) => (
              <AttendeeFields
                key={index}
                index={index}
                label={isTeam ? `Team ${index + 1}` : `Attendee ${index + 1}`}
                attendeeFields={attendeeFields}
                teamMemberFields={teamMemberFields}
                rosterSize={rosterSize}
                teamMemberLimit={event.teamMemberLimit}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {walkIn ? null : (
      <Card>
        <CardHeader>
          <CardTitle>Invoice</CardTitle>
          <CardDescription>Required for the invoice. Leave the name empty to invoice the customer.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch name="billingCompany" checked={company} onCheckedChange={setCompany} />
            Invoice to a company
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={company ? "Company name" : "Billing name"} htmlFor="billing.name">
              <Input id="billing.name" name="billing.name" required={company} />
            </FormField>
            {company ? (
              <FormField label="Tax number" htmlFor="billing.taxNumber">
                <Input id="billing.taxNumber" name="billing.taxNumber" required />
              </FormField>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-[120px_1fr_2fr]">
            <FormField label="ZIP" htmlFor="billing.zip">
              <Input id="billing.zip" name="billing.zip" required />
            </FormField>
            <FormField label="City" htmlFor="billing.city">
              <Input id="billing.city" name="billing.city" required />
            </FormField>
            <FormField label="Street" htmlFor="billing.street">
              <Input id="billing.street" name="billing.street" required />
            </FormField>
          </div>
        </CardContent>
      </Card>
      )}

      </div>

      <div className="grid content-start gap-6 xl:sticky xl:top-20">
      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
          <CardDescription>Collect the money first, then record how it was paid.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Payment method">
            {METHODS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={method === value}
                onClick={() => setMethod(value)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border p-4 text-base font-medium transition-colors",
                  method === value ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                <Icon className="size-5" /> {label}
              </button>
            ))}
          </div>
          {method === "card" && readers.length > 0 ? (
            <div className="grid gap-3 rounded-lg border p-3">
              <RadioGroup
                value={cardMode}
                onValueChange={(next) => setCardMode(next as typeof cardMode)}
                className="flex flex-wrap gap-4"
                aria-label="Card payment mode"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="cardMode-reader" value="reader" />
                  <Label htmlFor="cardMode-reader" className="cursor-pointer font-normal">
                    Charge on a SumUp reader
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="cardMode-manual" value="manual" />
                  <Label htmlFor="cardMode-manual" className="cursor-pointer font-normal">
                    Already taken another way
                  </Label>
                </div>
              </RadioGroup>
              {cardMode === "reader" ? (
                <FormField label="Reader" htmlFor="readerId" hint="The amount appears on the reader for the customer to tap or insert their card.">
                  <NativeSelect id="readerId" name="readerId" defaultValue={readers[0]?.id}>
                    {readers.map((reader) => (
                      <option key={reader.id} value={reader.id}>
                        {reader.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              ) : null}
            </div>
          ) : null}
          {method === "cash" || cardMode === "manual" || readers.length === 0 ? (
            <FormField
              label={method === "card" ? "Terminal receipt / transaction no. (optional)" : "Receipt no. (optional)"}
              htmlFor="reference"
            >
              <Input id="reference" name="reference" autoComplete="off" />
            </FormField>
          ) : null}
          <FormField label="Internal note (optional)" htmlFor="note">
            <Input id="note" name="note" placeholder="Never shown to the customer" />
          </FormField>
        </CardContent>
      </Card>

      {cardMessage ? (
        <Alert variant="destructive">
          <AlertDescription>{cardMessage}</AlertDescription>
        </Alert>
      ) : null}
      <ResultNotice result={state && !state.ok ? state : null} />
      {/* Below xl the summary column isn't sticky, so keep the pay button on screen. */}
      <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-20 -mx-4 border-t px-4 py-3 backdrop-blur md:-mx-6 md:px-6 xl:static xl:mx-0 xl:border-0 xl:bg-transparent xl:p-0 xl:backdrop-blur-none">
        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pending || (dayOptions !== null && tickets === 0)}>
          {pending
            ? "Processing…"
            : method === "card" && cardMode === "reader" && readers.length > 0
              ? `Send ${money(total)} to the reader`
              : walkIn
                ? `Record ${method} payment of ${money(total)} & make receipt`
                : `Record ${method} payment of ${money(total)} & send`}
        </Button>
      </div>
      </div>
    </form>
    </>
  );
}

/**
 * Shown while the customer pays on the reader. Polls the server, which
 * asks SumUp what happened — so it works even when SumUp's webhook can't
 * reach the app (local development, a firewall).
 */
function CardWaiting({
  bookingId,
  total,
  onResult,
}: {
  bookingId: string;
  total: string;
  onResult: (result: { state?: string; sale?: PosSaleResult; message?: string }) => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  // Kept in a ref so a re-render of the parent doesn't restart the polling timer.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let stopped = false;
    const timer = setInterval(async () => {
      const result = await pollCardSaleAction(bookingId);
      if (!stopped && result.state !== "waiting") onResultRef.current(result);
    }, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [bookingId]);

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="size-5 animate-spin" /> Waiting for the customer to pay {total}
        </CardTitle>
        <CardDescription>Ask the customer to tap or insert their card on the reader. This screen updates by itself.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          disabled={cancelling}
          onClick={async () => {
            setCancelling(true);
            onResult(await cancelCardSaleAction(bookingId));
            setCancelling(false);
          }}
        >
          {cancelling ? "Cancelling…" : "Cancel payment"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** After payment: what happened, and — for a walk-in — the big print button. */
function SaleComplete({ sale: initial, money, onNewSale }: { sale: PosSaleResult; money: (n: number) => string; onNewSale: () => void }) {
  const [sale, setSale] = useState(initial);
  const [retryState, retry, retrying] = useActionState(async () => {
    const result = await retryReceiptAction(sale.bookingId);
    if (result.sale) setSale(result.sale);
    return result;
  }, null);
  const receiptUrl = `/admin/bookings/${sale.bookingId}/receipt`;
  const walkIn = sale.delivery === "receipt";

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <CheckCircle2 className="text-success size-6" /> Paid — {money(sale.totalHuf)}
        </CardTitle>
        <CardDescription>
          {walkIn
            ? sale.vouchersIssued > 0
              ? `${sale.vouchersIssued} entr${sale.vouchersIssued === 1 ? "y" : "ies"} checked in — the customer can go straight in.`
              : "Walk-in sale recorded."
            : `${sale.vouchersIssued} ticket${sale.vouchersIssued === 1 ? "" : "s"} issued and emailed to the customer.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {walkIn ? (
          sale.receipt?.status === "issued" && sale.receipt.hasPdf ? (
            <div className="grid gap-2">
              <Button asChild size="lg" className="h-16 text-lg">
                <a href={receiptUrl} target="_blank" rel="noopener">
                  <Printer className="size-6" /> Print receipt {sale.receipt.number}
                </a>
              </Button>
              <p className="text-muted-foreground text-xs">
                Opens the receipt. iPad: tap <strong>Share → Print</strong>. Android: <strong>⋮ → Share → Print</strong>. Choose the
                receipt printer the first time; the tablet remembers it.
              </p>
            </div>
          ) : (
            <Alert variant="destructive">
              <AlertTitle>No receipt yet</AlertTitle>
              <AlertDescription>
                {sale.receipt?.error ?? "The receipt could not be issued."} The payment itself is recorded.
              </AlertDescription>
            </Alert>
          )
        ) : sale.invoiceStatus === "issued" ? (
          <Alert>
            <AlertDescription>Invoice issued{sale.invoiceEmailed ? " and emailed." : " — but the email could not be sent; resend it from the booking."}</AlertDescription>
          </Alert>
        ) : sale.invoiceStatus === "failed" ? (
          <Alert variant="destructive">
            <AlertTitle>Invoice failed</AlertTitle>
            <AlertDescription>{sale.invoiceError ?? "Unknown error."} The sale itself is recorded — retry from the booking.</AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertDescription>Invoicing is not enabled for this organization, so no invoice was created.</AlertDescription>
          </Alert>
        )}

        {walkIn && sale.receipt?.status !== "issued" ? (
          <form action={retry}>
            <Button type="submit" variant="outline" size="lg" disabled={retrying}>
              <RotateCcw /> {retrying ? "Trying again…" : "Try the receipt again"}
            </Button>
          </form>
        ) : null}
        {retryState && !retryState.ok && retryState.message !== sale.receipt?.error ? <ResultNotice result={retryState} /> : null}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button type="button" size="lg" variant={walkIn ? "secondary" : "default"} className="h-12" onClick={onNewSale}>
            <Plus /> New sale
          </Button>
          <Button asChild variant="ghost" size="lg" className="h-12">
            <Link href={`/admin/bookings/${sale.bookingId}`}>View booking</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
