"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, CreditCard, Minus, Plus } from "lucide-react";
import type { AttendeeFieldDef } from "@tbook/schemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FormField, ResultNotice } from "@/components/form-bits";
import { cn } from "@/lib/utils";
import { AttendeeFields } from "../bookings/new/attendee-fields";
import { createPosSaleAction, type PosSaleActionResult } from "../sales-actions";

const METHODS = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "card", label: "Card", icon: CreditCard },
] as const;

export function SaleForm({
  event,
  tickets,
  currency,
  total,
  attendeeFields,
  teamMemberFields,
}: {
  event: { id: string; teamMemberLimit: number | null; playersPerTicket: number };
  tickets: number;
  currency: string;
  total: number;
  attendeeFields: AttendeeFieldDef[];
  teamMemberFields: AttendeeFieldDef[];
}) {
  const router = useRouter();
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [company, setCompany] = useState(false);
  // The action's result outlives the success panel, so "New sale" dismisses
  // that specific sale instead of trying to reset the action state.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [state, action, pending] = useActionState(
    async (_prev: PosSaleActionResult | null, formData: FormData) => createPosSaleAction(formData),
    null,
  );

  const isTeam = teamMemberFields.length > 0;
  const rosterSize = event.playersPerTicket > 1 ? event.playersPerTicket : null;
  const money = (amount: number) => `${amount.toLocaleString("hu-HU")} ${currency}`;

  if (state?.ok && state.sale && state.sale.bookingId !== dismissedId) {
    const sale = state.sale;
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="text-primary size-5" /> Sale complete — {money(sale.totalHuf)}
          </CardTitle>
          <CardDescription>
            {sale.vouchersIssued} ticket{sale.vouchersIssued === 1 ? "" : "s"} issued and emailed to the customer.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {sale.invoiceStatus === "issued" ? (
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
          <div className="flex gap-2">
            <Button type="button" onClick={() => setDismissedId(sale.bookingId)}>
              New sale
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/bookings/${sale.bookingId}`}>View booking</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form action={action} className="grid max-w-3xl gap-6">
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="paymentMethod" value={method} />
      <input type="hidden" name="tickets" value={tickets} />

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
          <FormField
            label={method === "card" ? "Terminal receipt / transaction no. (optional)" : "Receipt no. (optional)"}
            htmlFor="reference"
          >
            <Input id="reference" name="reference" autoComplete="off" />
          </FormField>
          <FormField label="Internal note (optional)" htmlFor="note">
            <Input id="note" name="note" placeholder="Never shown to the customer" />
          </FormField>
        </CardContent>
      </Card>

      <ResultNotice result={state && !state.ok ? state : null} />
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Processing…" : `Record ${method} payment of ${money(total)} & send`}
        </Button>
      </div>
    </form>
  );
}
