"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FormField, ResultNotice } from "@/components/form-bits";
import { pairReaderAction, removeReaderAction, saveSumUpAction, type SumUpActionResult } from "../sumup-actions";

export interface SumUpCardProps {
  enabled: boolean;
  merchantCode: string;
  apiKey: { configured: boolean; hint: string };
  affiliateAppId: string;
  affiliateKey: { configured: boolean; hint: string };
  readers: Array<{ id: string; name: string; model: string }>;
  webhookReachable: boolean;
}

/**
 * SumUp card terminals. Only Solo readers can be driven from here; anything
 * else is still recorded by hand at the point of sale, so a shop with a mix
 * of terminals loses nothing by connecting just its Solos.
 */
export function SumUpCard(props: SumUpCardProps) {
  const [saved, save, saving] = useActionState(async (_p: SumUpActionResult | null, f: FormData) => saveSumUpAction(f), null);
  const [paired, pair, pairing] = useActionState(async (_p: SumUpActionResult | null, f: FormData) => pairReaderAction(f), null);
  const [removed, remove] = useActionState(async (_p: SumUpActionResult | null, f: FormData) => removeReaderAction(String(f.get("readerId"))), null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>SumUp card terminals</CardTitle>
        <CardDescription>
          Let sellers charge a card on a paired <strong>SumUp Solo</strong> straight from the point of sale. Other SumUp terminals (Air, 3G, PIN+)
          can&apos;t be connected this way — sellers record those card payments by hand instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {!props.webhookReachable ? (
          <Alert>
            <AlertDescription>
              This server isn&apos;t on a public https address (<code>NEXT_PUBLIC_APP_URL</code>), so SumUp can&apos;t call back. Payments still complete — the
              seller&apos;s screen checks with SumUp every few seconds.
            </AlertDescription>
          </Alert>
        ) : null}

        <form action={save} className="grid gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch name="enabled" defaultChecked={props.enabled} />
            Enable card payments on SumUp readers
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Merchant code" htmlFor="merchantCode" hint="Shown in your SumUp dashboard profile, like MH4H92C7.">
              <Input id="merchantCode" name="merchantCode" defaultValue={props.merchantCode} />
            </FormField>
            <FormField
              label="API key"
              htmlFor="apiKey"
              hint={props.apiKey.configured ? `Saved (${props.apiKey.hint}). Leave empty to keep it.` : "Create one in the SumUp developer settings."}
            >
              <Input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={props.apiKey.configured ? "••••••••" : ""} />
            </FormField>
            <FormField label="Affiliate app id" htmlFor="affiliateAppId" hint="From SumUp's Affiliate Keys page — required on every reader payment.">
              <Input id="affiliateAppId" name="affiliateAppId" defaultValue={props.affiliateAppId} />
            </FormField>
            <FormField
              label="Affiliate key"
              htmlFor="affiliateKey"
              hint={props.affiliateKey.configured ? `Saved (${props.affiliateKey.hint}). Leave empty to keep it.` : undefined}
            >
              <Input id="affiliateKey" name="affiliateKey" type="password" autoComplete="off" placeholder={props.affiliateKey.configured ? "••••••••" : ""} />
            </FormField>
          </div>
          <ResultNotice result={saved} />
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save SumUp settings"}
            </Button>
          </div>
        </form>

        <div className="grid gap-3 border-t pt-4">
          <h3 className="text-sm font-medium">Paired readers</h3>
          {props.readers.length === 0 ? (
            <p className="text-muted-foreground text-sm">No readers yet.</p>
          ) : (
            <ul className="grid gap-2">
              {props.readers.map((reader) => (
                <li key={reader.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-sm font-medium">
                    {reader.name} <Badge variant="secondary">{reader.model}</Badge>
                  </span>
                  <form action={remove}>
                    <input type="hidden" name="readerId" value={reader.id} />
                    <Button type="submit" variant="ghost" size="icon" aria-label={`Remove ${reader.name}`}>
                      <Trash2 />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <ResultNotice result={removed} />

          <form action={pair} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <FormField label="Pairing code" htmlFor="pairingCode" hint="On the reader: Connections → API → Connect. It expires after 5 minutes.">
              <Input id="pairingCode" name="pairingCode" autoComplete="off" required />
            </FormField>
            <FormField label="Name" htmlFor="readerName" hint="What sellers will see, e.g. “Counter 1”.">
              <Input id="readerName" name="name" required />
            </FormField>
            <Button type="submit" disabled={pairing || !props.enabled}>
              {pairing ? "Pairing…" : "Pair reader"}
            </Button>
          </form>
          {!props.enabled ? <p className="text-muted-foreground text-xs">Save valid credentials and enable SumUp before pairing a reader.</p> : null}
          <ResultNotice result={paired} />
        </div>
      </CardContent>
    </Card>
  );
}
