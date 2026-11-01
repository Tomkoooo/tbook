"use client";

import { useActionState, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResultNotice, SecretNotice } from "@/components/form-bits";
import { SectionCard } from "@/components/section-card";
import { revokeInventoryKeyAction, rotateInventoryKeyAction } from "../product-actions";

/** The webshop's key to products and stock. Shown once on creation; only its hash is stored. */
export function InventoryApiCard({ configured, hint, apiBaseUrl }: { configured: boolean; hint: string; apiBaseUrl: string }) {
  const [created, rotate, rotating] = useActionState(async () => rotateInventoryKeyAction(), null);
  const [revoked, revoke, revoking] = useActionState(async () => revokeInventoryKeyAction(), null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const active = created?.apiKey ? true : revoked?.ok ? false : configured;

  return (
    <SectionCard
      title="Inventory API (webshop)"
      description="Lets the webshop list products, check stock and reserve items at checkout from the same stock the counter sells. See docs/inventory-api.md."
      actions={<Badge variant={active ? "success" : "neutral"}>{active ? "Key active" : "No key"}</Badge>}
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Base URL</span>
          <Input value={apiBaseUrl} readOnly className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Inventory API base URL" />
        </div>
        {created?.apiKey ? (
          <SecretNotice label="API key — copy it into the webshop's server settings now. It won't be shown again:" value={created.apiKey} />
        ) : active ? (
          <p className="text-muted-foreground text-sm">
            Current key: <code className="font-mono">{hint}</code>
          </p>
        ) : null}
        <ResultNotice result={created && !created.ok ? created : revoked} />
        <div className="flex flex-wrap items-center gap-2">
          <form action={rotate}>
            <Button type="submit" variant={active ? "outline" : "default"} disabled={rotating}>
              <KeyRound /> {rotating ? "Creating…" : active ? "Replace key" : "Create key"}
            </Button>
          </form>
          {active ? (
            confirmRevoke ? (
              <form action={revoke} className="flex items-center gap-1">
                <Button type="submit" variant="destructive" disabled={revoking}>
                  {revoking ? "Revoking…" : "Confirm revoke"}
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="Cancel" onClick={() => setConfirmRevoke(false)}>
                  <X />
                </Button>
              </form>
            ) : (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmRevoke(true)}>
                Revoke
              </Button>
            )
          ) : null}
        </div>
        {active && !created?.apiKey ? (
          <p className="text-muted-foreground text-xs">Replacing the key stops the old one immediately — update the webshop at the same time.</p>
        ) : null}
      </div>
    </SectionCard>
  );
}
