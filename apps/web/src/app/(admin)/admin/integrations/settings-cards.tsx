"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { SecretField } from "@/components/secret-field";
import { SectionCard } from "@/components/section-card";
import type { OrganizationSettingsView } from "@tbook/services";
import {
  saveSmtpSettingsAction,
  saveStripeSettingsAction,
  saveSzamlazzSettingsAction,
  sendSmtpTestAction,
  type SettingsActionResult,
} from "../settings-actions";

type Action = (formData: FormData) => Promise<SettingsActionResult>;

function useFormAction(action: Action) {
  return useActionState(async (_prev: SettingsActionResult | null, formData: FormData) => action(formData), null);
}

function StatusBadge({ on, onLabel = "Active", offLabel = "Off" }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return <Badge variant={on ? "success" : "neutral"}>{on ? onLabel : offLabel}</Badge>;
}

function EnabledSwitch({ id, defaultChecked, label }: { id: string; defaultChecked: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} name="enabled" defaultChecked={defaultChecked} />
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
    </div>
  );
}

/* ---- Stripe --------------------------------------------------------------- */

export function StripeCard({ stripe, webhookUrl }: { stripe: OrganizationSettingsView["stripe"]; webhookUrl: string }) {
  const [state, action, pending] = useFormAction(saveStripeSettingsAction);
  return (
    <SectionCard
      title="Stripe (online card payments)"
      description="Use your own Stripe account for storefront payments. When this is off, the platform's Stripe account is used."
      actions={<StatusBadge on={stripe.enabled} onLabel="Own account" offLabel="Platform account" />}
    >
      <form action={action} className="grid gap-4">
        <EnabledSwitch id="stripe-enabled" defaultChecked={stripe.enabled} label="Take payments into this organization's Stripe account" />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Publishable key" htmlFor="publishableKey" hint="Starts with pk_live_ or pk_test_.">
            <Input id="publishableKey" name="publishableKey" defaultValue={stripe.publishableKey} autoComplete="off" />
          </FormField>
          <SecretField id="secretKey" label="Secret key" saved={stripe.secretKey} hint="Starts with sk_live_ (or a restricted rk_ key)." />
          <SecretField
            id="webhookSecret"
            label="Webhook signing secret"
            saved={stripe.webhookSecret}
            hint="Starts with whsec_. Shown when you add the endpoint below in Stripe."
          />
          <FormField label="Webhook endpoint" htmlFor="stripe-webhook-url" hint="In Stripe: Developers → Webhooks → Add endpoint. Send checkout.session.* events.">
            <Input id="stripe-webhook-url" value={webhookUrl} readOnly className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          </FormField>
        </div>
        <ResultNotice result={state} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save Stripe settings"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/* ---- SMTP ------------------------------------------------------------------ */

export function SmtpCard({ smtp }: { smtp: OrganizationSettingsView["smtp"] }) {
  const [state, action, pending] = useFormAction(saveSmtpSettingsAction);
  const [testState, test, testing] = useActionState(async () => sendSmtpTestAction(), null);
  const configured = Boolean(smtp.host);
  return (
    <SectionCard
      title="Email sending (SMTP)"
      description="Booking emails and invites go out through this server, from your own address. Leave the host empty to use the platform's mail server."
      actions={<StatusBadge on={configured} onLabel="Own server" offLabel="Platform server" />}
    >
      <div className="grid gap-4">
        <form action={action} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <FormField label="SMTP host" htmlFor="host">
              <Input id="host" name="host" defaultValue={smtp.host} placeholder="smtp.gmail.com" autoComplete="off" />
            </FormField>
            <FormField label="Port" htmlFor="port" hint="465 (SSL) or 587">
              <Input id="port" name="port" type="number" min={1} max={65535} defaultValue={smtp.port} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Username" htmlFor="user">
              <Input id="user" name="user" defaultValue={smtp.user} autoComplete="off" />
            </FormField>
            <SecretField id="pass" label="Password" saved={smtp.pass} hint="For Gmail, use an app password." />
            <FormField label="From address" htmlFor="fromEmail" hint="Defaults to the username.">
              <Input id="fromEmail" name="fromEmail" type="email" defaultValue={smtp.fromEmail} placeholder="jegy@pelda.hu" />
            </FormField>
            <FormField label="From name" htmlFor="fromName">
              <Input id="fromName" name="fromName" defaultValue={smtp.fromName} placeholder="Magyar Darts Szövetség" />
            </FormField>
          </div>
          <ResultNotice result={state} />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save email settings"}
            </Button>
          </div>
        </form>
        <form action={test} className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="submit" variant="outline" disabled={testing}>
            <Send /> {testing ? "Sending…" : "Send a test email to me"}
          </Button>
          <span className="text-muted-foreground text-sm">Uses the saved settings — save first.</span>
        </form>
        <ResultNotice result={testState} />
      </div>
    </SectionCard>
  );
}

/* ---- Számlázz.hu ------------------------------------------------------------ */

export function SzamlazzCard({ szamlazz }: { szamlazz: OrganizationSettingsView["szamlazz"] }) {
  const [state, action, pending] = useFormAction(saveSzamlazzSettingsAction);
  return (
    <SectionCard
      title="Számlázz.hu (invoices)"
      description="Invoices for emailed bookings (attached to the booking email) and receipts (nyugta) for walk-in sales at the point of sale. Supports HUF and EUR."
      actions={<StatusBadge on={szamlazz.enabled} />}
    >
      <form action={action} className="grid gap-4">
        <EnabledSwitch id="szamlazz-enabled" defaultChecked={szamlazz.enabled} label="Issue invoices automatically" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SecretField
            id="agentKey"
            label="Agent key (Számla Agent kulcs)"
            saved={szamlazz.agentKey}
            hint="Számlázz.hu → Beállítások → Számla Agent kulcsok."
          />
          <FormField label="Seller name" htmlFor="sellerName" hint="Optional — overrides the name on the invoice.">
            <Input id="sellerName" name="sellerName" defaultValue={szamlazz.sellerName} />
          </FormField>
          <FormField label="Bank" htmlFor="sellerBank">
            <Input id="sellerBank" name="sellerBank" defaultValue={szamlazz.sellerBank} placeholder="OTP Bank" />
          </FormField>
          <FormField label="Bank account" htmlFor="sellerBankAccount">
            <Input
              id="sellerBankAccount"
              name="sellerBankAccount"
              defaultValue={szamlazz.sellerBankAccount}
              placeholder="11773016-11111111-00000000"
              className="font-mono"
            />
          </FormField>
        </div>
        <fieldset className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <legend className="sr-only">Walk-in receipts</legend>
          <FormField label="Receipt number prefix" htmlFor="receiptPrefix" hint="Printed before the receipt number, e.g. NYGTA-2026-12.">
            <Input id="receiptPrefix" name="receiptPrefix" defaultValue={szamlazz.receiptPrefix} maxLength={10} className="font-mono uppercase" />
          </FormField>
          <FormField label="Receipt paper" htmlFor="receiptTemplate" hint="Match the printer at the counter.">
            <NativeSelect id="receiptTemplate" name="receiptTemplate" defaultValue={szamlazz.receiptTemplate}>
              <option value="A">A4 — regular office printer</option>
              <option value="N">80 mm roll — receipt printer</option>
            </NativeSelect>
          </FormField>
        </fieldset>
        <ResultNotice result={state} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save Számlázz.hu settings"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
