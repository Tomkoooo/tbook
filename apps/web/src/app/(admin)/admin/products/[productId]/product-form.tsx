"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { optionKey, suggestSku, variantCombinations, variantLabel } from "@tbook/domain";
import type { ProductView } from "@tbook/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckboxField, FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { ImageManager } from "@/components/image-manager";
import { Notice } from "@/components/notice";
import { RichTextEditor } from "@/components/rich-text-editor";
import { SectionCard } from "@/components/section-card";
import { StickyFormFooter, UnsavedBadge } from "@/components/sticky-form-footer";
import { TagInput } from "@/components/tag-input";
import { cn } from "@/lib/utils";
import { saveProductAction, type ProductActionResult } from "../../product-actions";

type PriceMode = "gross" | "net";

interface OptionDraft {
  name: string;
  values: string[];
}

/** Per-combination settings the admin typed; keyed by optionKey(options). */
interface VariantDraft {
  sku: string;
  /** Price in the current price mode; "" = use the product price. */
  price: string;
  active: boolean;
  initialStock: number;
  /** True once the admin edited the SKU by hand (stops auto-suggesting it). */
  skuTouched: boolean;
}

const OPTION_PRESETS = [
  { name: "Size", values: ["S", "M", "L", "XL", "XXL"] },
  { name: "Color", values: [] as string[] },
];

/** Rounds a gross price the way the currency is charged (HUF: whole forints). */
function roundGross(value: number, currency: string): number {
  return currency === "HUF" ? Math.round(value) : Math.round(value * 100) / 100;
}

function toGross(text: string, mode: PriceMode, vat: number, currency: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return roundGross(mode === "gross" ? value : value * (1 + vat / 100), currency);
}

/** The shared dash-separated start of existing SKUs (TEE-2026-M, TEE-2026-L → TEE-2026). */
function commonSkuPrefix(skus: string[]): string {
  if (skus.length === 0) return "";
  const parts = skus.map((sku) => sku.split("-"));
  const shared: string[] = [];
  for (let i = 0; i < parts[0]!.length; i += 1) {
    const segment = parts[0]![i]!;
    if (!parts.every((p) => p[i] === segment)) break;
    shared.push(segment);
  }
  // A single-variant product's whole SKU matches itself; keep it as the prefix.
  return shared.join("-");
}

function fromGross(gross: number, mode: PriceMode, vat: number): string {
  return String(mode === "gross" ? gross : Math.round((gross / (1 + vat / 100)) * 100) / 100);
}

/**
 * Product editor. Options (Size, Color…) are chips; the variant list
 * follows them automatically — one row per combination — and existing
 * variants keep their id and stock. Prices can be entered net or gross.
 * Stock of saved variants changes only in the Stock section above.
 */
export function ProductForm({ product, canEdit, currency }: { product: ProductView | null; canEdit: boolean; currency: string }) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  const [name, setName] = useState(product?.name ?? "");
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [vat, setVat] = useState<number>(product?.vatPercent ?? 27);
  const [mode, setMode] = useState<PriceMode>("gross");
  const [price, setPrice] = useState(product ? String(product.priceGross) : "");
  const [skuPrefix, setSkuPrefix] = useState(() => commonSkuPrefix(product?.variants.map((v) => v.sku) ?? []));
  const [options, setOptions] = useState<OptionDraft[]>(product?.variantOptions.map((o) => ({ name: o.name, values: [...o.values] })) ?? []);

  const saved = useMemo(() => new Map((product?.variants ?? []).map((v) => [optionKey(v.options), v])), [product]);
  const [drafts, setDrafts] = useState<Record<string, VariantDraft>>(() =>
    Object.fromEntries(
      (product?.variants ?? []).map((v) => [
        optionKey(v.options),
        { sku: v.sku, price: v.ownPriceGross == null ? "" : String(v.ownPriceGross), active: v.active, initialStock: 0, skuTouched: true },
      ]),
    ),
  );

  const optionDefs = options.map((o) => ({ name: o.name.trim(), values: o.values })).filter((o) => o.name && o.values.length > 0);
  // Keyed by content, so typing elsewhere doesn't rebuild the combinations.
  const optionSignature = JSON.stringify(optionDefs);
  const combos = useMemo(() => variantCombinations(JSON.parse(optionSignature) as typeof optionDefs), [optionSignature]);

  const rows = combos.map((combo) => {
    const key = optionKey(combo);
    const existing = saved.get(key);
    const draft = drafts[key] ?? { sku: suggestSku(skuPrefix || name || "ITEM", combo), price: "", active: true, initialStock: 0, skuTouched: false };
    // Untouched new SKUs follow the prefix.
    const sku = draft.skuTouched ? draft.sku : suggestSku(skuPrefix || name || "ITEM", combo);
    return { key, combo, existing, draft: { ...draft, sku } };
  });
  const comboKeys = new Set(rows.map((r) => r.key));
  const dropped = [...saved.entries()].filter(([key]) => !comboKeys.has(key)).map(([, v]) => v);
  const blockedDrops = dropped.filter((v) => v.onHand > 0 || v.reserved > 0);

  const updateDraft = (key: string, current: VariantDraft, patch: Partial<VariantDraft>) => {
    setDrafts((all) => ({ ...all, [key]: { ...current, ...patch } }));
    touch();
  };

  function switchMode(next: PriceMode) {
    if (next === mode) return;
    const convert = (text: string) => {
      const gross = toGross(text, mode, vat, currency);
      return gross == null ? text : fromGross(gross, next, vat);
    };
    setPrice(convert(price));
    setDrafts((all) => Object.fromEntries(Object.entries(all).map(([k, d]) => [k, { ...d, price: convert(d.price) }])));
    setMode(next);
  }

  function setAll(patch: Partial<VariantDraft>) {
    setDrafts((all) => {
      const next = { ...all };
      for (const row of rows) next[row.key] = { ...row.draft, ...patch, ...(patch.initialStock !== undefined && row.existing ? { initialStock: 0 } : {}) };
      return next;
    });
    touch();
  }

  const productGross = toGross(price, mode, vat, currency);

  const [state, action, pending] = useActionState(async (_prev: ProductActionResult | null, formData: FormData) => {
    const payload = {
      name,
      description: String(formData.get("description") ?? ""),
      images,
      category: String(formData.get("category") ?? ""),
      status: String(formData.get("status") ?? "draft"),
      channels: ["pos", "webshop"].filter((c) => formData.get(`channel-${c}`) !== null),
      priceGross: productGross ?? 0,
      vatPercent: vat,
      variantOptions: optionDefs,
      variants: rows.map(({ combo, existing, draft }) => ({
        ...(existing ? { id: existing.id } : {}),
        sku: draft.sku,
        options: combo,
        priceGross: toGross(draft.price, mode, vat, currency),
        active: draft.active,
        initialStock: existing ? 0 : draft.initialStock,
      })),
    };
    const data = new FormData();
    data.set("payload", JSON.stringify(payload));
    const result = await saveProductAction(product?.id ?? null, data);
    if (result.ok && result.product) {
      setDirty(false);
      if (!product) router.push(`/admin/products/${result.product.id}`);
      else router.refresh();
    }
    return result;
  }, null);

  const otherPrice = (text: string) => {
    const gross = toGross(text, mode, vat, currency);
    if (gross == null) return null;
    return mode === "gross" ? `net ${fromGross(gross, "net", vat)} ${currency}` : `gross ${gross} ${currency}`;
  };

  return (
    <form action={action} onChange={touch} className="grid gap-6">
      <SectionCard title="Product">
        <fieldset disabled={!canEdit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <FormField label="Name" htmlFor="name">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Póló 2026" />
            </FormField>
            <FormField label="Category" htmlFor="category" hint="Free text, e.g. Ruha, Kiegészítő.">
              <Input id="category" name="category" defaultValue={product?.category ?? ""} />
            </FormField>
          </div>
          <FormField label="Description" hint="Shown in the webshop. Formatting is kept; scripts and styles are removed.">
            <RichTextEditor name="description" initialValue={product?.description ?? ""} ariaLabel="Product description" onChange={touch} disabled={!canEdit} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Status" htmlFor="status" hint="Only active products are on sale.">
              <NativeSelect id="status" name="status" defaultValue={product?.status ?? "draft"}>
                <option value="draft">Draft (hidden)</option>
                <option value="active">Active (on sale)</option>
                <option value="archived">Archived</option>
              </NativeSelect>
            </FormField>
            <fieldset className="grid content-start gap-2">
              <legend className="mb-2 text-sm font-medium">Sold on</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <CheckboxField name="channel-pos" label="Point of sale" defaultChecked={product?.channels.includes("pos") ?? true} onCheckedChange={touch} />
                <CheckboxField name="channel-webshop" label="Webshop" defaultChecked={product?.channels.includes("webshop") ?? true} onCheckedChange={touch} />
              </div>
            </fieldset>
          </div>
        </fieldset>
      </SectionCard>

      <SectionCard title="Images">
        <ImageManager
          images={images}
          disabled={!canEdit}
          onChange={(next) => {
            setImages(next);
            touch();
          }}
        />
      </SectionCard>

      <SectionCard
        title="Price"
        actions={
          <div className="bg-muted flex rounded-md p-0.5" role="radiogroup" aria-label="Enter prices as">
            {(["gross", "net"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => switchMode(m)}
                className={cn("rounded px-3 py-1 text-sm font-medium", mode === m ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                {m === "gross" ? "Gross (incl. VAT)" : "Net (excl. VAT)"}
              </button>
            ))}
          </div>
        }
      >
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <FormField label={`Price, ${mode} (${currency})`} htmlFor="price" hint={otherPrice(price) ?? "Variants can override it."}>
            <Input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required className="tabular-nums" />
          </FormField>
          <FormField label="VAT %" htmlFor="vatPercent">
            <NativeSelect id="vatPercent" value={String(vat)} onChange={(e) => setVat(Number(e.target.value))}>
              {[27, 18, 5, 0].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}%
                </option>
              ))}
              {![27, 18, 5, 0].includes(vat) ? <option value={vat}>{vat}%</option> : null}
            </NativeSelect>
          </FormField>
        </fieldset>
      </SectionCard>

      <SectionCard title="Options" description="Sizes, colours… Every combination becomes a variant with its own SKU and stock. Leave empty if the product comes in one version.">
        <div className="grid gap-4">
          {options.map((option, index) => (
            <div key={index} className="grid items-start gap-3 sm:grid-cols-[12rem_1fr_auto]">
              <FormField label="Option" htmlFor={`opt-name-${index}`}>
                <Input
                  id={`opt-name-${index}`}
                  value={option.name}
                  placeholder="Size"
                  disabled={!canEdit}
                  onChange={(e) => setOptions((o) => o.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)))}
                />
              </FormField>
              <FormField label="Values" htmlFor={`opt-values-${index}`} hint="Type a value and press Enter. Paste “S, M, L” to add several.">
                <TagInput
                  id={`opt-values-${index}`}
                  values={option.values}
                  disabled={!canEdit}
                  placeholder="S, M, L…"
                  onChange={(values) => {
                    setOptions((o) => o.map((x, i) => (i === index ? { ...x, values } : x)));
                    touch();
                  }}
                />
              </FormField>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="sm:mt-6"
                  aria-label={`Remove option ${option.name}`}
                  onClick={() => {
                    setOptions((o) => o.filter((_, i) => i !== index));
                    touch();
                  }}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ))}
          {canEdit && options.length < 3 ? (
            <div className="flex flex-wrap gap-2">
              {OPTION_PRESETS.filter((preset) => !options.some((o) => o.name.toLowerCase() === preset.name.toLowerCase())).map((preset) => (
                <Button
                  key={preset.name}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOptions((o) => [...o, { name: preset.name, values: [...preset.values] }]);
                    touch();
                  }}
                >
                  <Plus /> {preset.name}
                  {preset.values.length ? ` (${preset.values[0]}–${preset.values.at(-1)})` : ""}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOptions((o) => [...o, { name: "", values: [] }]);
                  touch();
                }}
              >
                <Plus /> Other option
              </Button>
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title={`Variants (${rows.length})`} description="Generated from the options. Empty own price = product price." flush>
        <div className="grid gap-3 border-b p-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <FormField label="SKU prefix" htmlFor="skuPrefix" hint="New variants get SKUs like PREFIX-M-BLACK. You can still edit each one.">
            <Input
              id="skuPrefix"
              value={skuPrefix}
              disabled={!canEdit}
              className="max-w-xs font-mono uppercase"
              onChange={(e) => setSkuPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9._-]/g, ""))}
            />
          </FormField>
          {canEdit && rows.length > 1 ? <BulkSet mode={mode} currency={currency} onSet={setAll} /> : null}
        </div>
        {blockedDrops.length > 0 ? (
          <div className="border-b p-4">
            <Notice tone="warning">
              Removing these option values would delete variants that still have stock:{" "}
              <strong>{blockedDrops.map((v) => `${v.sku} (${v.onHand})`).join(", ")}</strong>. Set their stock to 0 first, or keep the value and switch the
              variant off.
            </Notice>
          </div>
        ) : dropped.length > 0 ? (
          <div className="border-b p-4">
            <Notice tone="info">Will be deleted on save: {dropped.map((v) => v.sku).join(", ")}.</Notice>
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variant</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Own price ({mode})</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>On sale</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ key, combo, existing, draft }) => (
              <TableRow key={key || "single"}>
                <TableCell className="font-medium">
                  {variantLabel(combo, optionDefs) || name || "—"}
                  {!existing ? (
                    <Badge variant="info" className="ml-2">
                      new
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Input
                    value={draft.sku}
                    aria-label="SKU"
                    disabled={!canEdit}
                    required
                    className="h-8 w-48 font-mono text-xs uppercase"
                    onChange={(e) => updateDraft(key, draft, { sku: e.target.value.toUpperCase(), skuTouched: true })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={draft.price}
                    aria-label="Own price"
                    inputMode="decimal"
                    disabled={!canEdit}
                    placeholder={price || "—"}
                    className="h-8 w-28 tabular-nums"
                    onChange={(e) => updateDraft(key, draft, { price: e.target.value })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  {existing ? (
                    <span className="font-medium tabular-nums" title="Change stock in the Stock section above">
                      {existing.available}
                      {existing.reserved ? <span className="text-muted-foreground text-xs"> +{existing.reserved} res.</span> : null}
                    </span>
                  ) : (
                    <Input
                      value={draft.initialStock}
                      aria-label="Starting stock"
                      type="number"
                      min={0}
                      disabled={!canEdit}
                      className="ml-auto h-8 w-20 text-right"
                      onChange={(e) => updateDraft(key, draft, { initialStock: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <Switch checked={draft.active} disabled={!canEdit} aria-label="On sale" onCheckedChange={(active) => updateDraft(key, draft, { active })} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      {canEdit ? (
        <StickyFormFooter
          status={
            <span className="flex flex-wrap items-center gap-3">
              {blockedDrops.length > 0 ? (
                <span className="text-warning inline-flex items-center gap-1">
                  <AlertTriangle className="size-4" /> Stocked variants would be deleted
                </span>
              ) : null}
              <UnsavedBadge dirty={dirty} />
            </span>
          }
        >
          <Button type="submit" size="lg" disabled={pending || blockedDrops.length > 0}>
            {pending ? "Saving…" : product ? "Save product" : "Create product"}
          </Button>
          <ResultNotice result={state} />
        </StickyFormFooter>
      ) : null}
    </form>
  );
}

/** "Set for all variants": a price (in the current mode) and/or starting stock for new variants. */
function BulkSet({ mode, currency, onSet }: { mode: PriceMode; currency: string; onSet: (patch: Partial<VariantDraft>) => void }) {
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStock, setBulkStock] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <FormField label={`All prices (${mode}, ${currency})`} htmlFor="bulkPrice">
        <Input id="bulkPrice" inputMode="decimal" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} className="w-32" />
      </FormField>
      <FormField label="All new stock" htmlFor="bulkStock">
        <Input id="bulkStock" type="number" min={0} value={bulkStock} onChange={(e) => setBulkStock(e.target.value)} className="w-24" />
      </FormField>
      <Button
        type="button"
        variant="secondary"
        disabled={bulkPrice.trim() === "" && bulkStock === ""}
        onClick={() =>
          onSet({
            ...(bulkPrice.trim() !== "" ? { price: bulkPrice.trim() } : {}),
            ...(bulkStock !== "" ? { initialStock: Math.max(0, Number(bulkStock) || 0) } : {}),
          })
        }
      >
        Apply to all
      </Button>
    </div>
  );
}
