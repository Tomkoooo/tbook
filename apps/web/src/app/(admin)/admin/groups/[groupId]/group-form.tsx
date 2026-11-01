"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormField, NativeSelect, ResultNotice, SecretNotice, StatusSelect } from "@/components/form-bits";
import { StickyFormFooter, UnsavedBadge } from "@/components/sticky-form-footer";
import { rotateGroupKeyAction, saveGroupAction, type CatalogActionResult } from "../../catalog-actions";

export interface GroupFormValues {
  name: string;
  description: string;
  status: string;
  defaultPriceBasis: string;
  defaultVatPercent: number;
  listOnTBookSite: boolean;
  listingTitle: string;
  listingUrl: string;
}

export const EMPTY_GROUP: GroupFormValues = {
  name: "",
  description: "",
  status: "draft",
  defaultPriceBasis: "net",
  defaultVatPercent: 27,
  listOnTBookSite: false,
  listingTitle: "",
  listingUrl: "",
};

export function GroupForm({
  groupId,
  initial,
  apiKeyHint,
  canManageKey,
}: {
  groupId: string | null;
  initial: GroupFormValues;
  apiKeyHint?: string;
  canManageKey: boolean;
}) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState(async (_prev: CatalogActionResult | null, formData: FormData) => {
    const result = await saveGroupAction(groupId, formData);
    if (result.ok) setDirty(false);
    // A new group's key is only readable in this response, so stay on the page when one came back.
    if (result.ok && !groupId && result.id && !result.apiKey) router.replace(`/admin/groups/${result.id}`);
    return result;
  }, null);

  const [keyState, rotate, rotating] = useActionState(
    async (_prev: CatalogActionResult | null) => (groupId ? rotateGroupKeyAction(groupId) : null),
    null,
  );

  const secret = keyState?.apiKey ?? state?.apiKey;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <form action={action} onChange={() => setDirty(true)} className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Group details</CardTitle>
            <CardDescription>A group is the brand or series that owns events, hotels and one public API key.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormField label="Name" htmlFor="name">
              <Input id="name" name="name" required defaultValue={initial.name} />
            </FormField>
            <FormField label="Description" htmlFor="description">
              <Textarea id="description" name="description" rows={3} defaultValue={initial.description} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Status" htmlFor="status">
                <StatusSelect defaultValue={initial.status} />
              </FormField>
              <FormField label="Default price basis" htmlFor="defaultPriceBasis">
                <NativeSelect id="defaultPriceBasis" name="defaultPriceBasis" defaultValue={initial.defaultPriceBasis}>
                  <option value="net">Net (excl. VAT)</option>
                  <option value="gross">Gross (incl. VAT)</option>
                </NativeSelect>
              </FormField>
              <FormField label="Default VAT %" htmlFor="defaultVatPercent">
                <Input id="defaultVatPercent" name="defaultVatPercent" type="number" min={0} max={100} step="0.1" defaultValue={initial.defaultVatPercent} />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Public listing</CardTitle>
            <CardDescription>Optionally list this group on the public tBook directory.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch name="listOnTBookSite" defaultChecked={initial.listOnTBookSite} />
              List on the tBook site
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Listing title" htmlFor="listingTitle">
                <Input id="listingTitle" name="listingTitle" defaultValue={initial.listingTitle} />
              </FormField>
              <FormField label="Listing URL" htmlFor="listingUrl">
                <Input id="listingUrl" name="listingUrl" type="url" defaultValue={initial.listingUrl} />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <StickyFormFooter status={<UnsavedBadge dirty={dirty} />}>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Saving…" : groupId ? "Save group" : "Create group"}
          </Button>
          <ResultNotice result={state} />
        </StickyFormFooter>
      </form>

      <div className="grid content-start gap-4">
        {secret ? <SecretNotice label="API key — copy it now, it won't be shown again:" value={secret} /> : null}
        {groupId && canManageKey ? (
          <Card>
            <CardHeader>
              <CardTitle>API key</CardTitle>
              <CardDescription>
                Used by the partner storefront. Current key: <code>{apiKeyHint}</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ResultNotice result={keyState && !keyState.apiKey ? keyState : null} />
              <form action={rotate}>
                <Button type="submit" variant="outline" disabled={rotating}>
                  {rotating ? "Rotating…" : "Rotate key"}
                </Button>
              </form>
              <p className="text-muted-foreground text-xs">The old key stops working immediately — update the storefront right after.</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
