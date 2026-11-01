"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ImagePlus, Loader2, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  DEFAULT_VOUCHER_PDF_LAYOUT,
  VOUCHER_PDF_MERGE_FIELDS,
  type VoucherPdfBlock,
  type VoucherPdfBlockType,
  type VoucherPdfLayout,
} from "@tbook/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { SectionCard } from "@/components/section-card";
import { cn } from "@/lib/utils";
import { saveVoucherPdfLayoutAction, type SettingsActionResult } from "../../settings-actions";

interface BlockMeta {
  label: string;
  hint: string;
  /** Which controls the block offers. */
  text?: boolean;
  size?: boolean;
  color?: boolean;
  align?: boolean;
  bold?: boolean;
  image?: boolean;
  /** Deletable and addable by the admin; the rest are built in and can only be switched off. */
  removable?: boolean;
}

const BLOCKS: Record<VoucherPdfBlockType, BlockMeta> = {
  headerImage: { label: "Header image", hint: "The event or group's header picture, or one you upload here.", image: true, align: true },
  title: { label: "Event name", hint: "", size: true, color: true, align: true, bold: true },
  eventSchedule: { label: "Date & time", hint: "For day passes, the day of the pass.", size: true, color: true, align: true, bold: true },
  location: { label: "Venue", hint: "", size: true, color: true, align: true, bold: true },
  subtitle: { label: "Guest name", hint: "", size: true, color: true, align: true, bold: true },
  attendeeFields: { label: "Registration answers", hint: "What the guest answered on the booking form.", size: true, color: true, align: true, bold: true },
  qrCode: { label: "QR code", hint: "Scanned at the door — it can't be turned off.", align: true },
  customText: { label: "Text", hint: "", text: true, size: true, color: true, align: true, bold: true, removable: true },
  image: { label: "Picture", hint: "A logo, sponsor banner or map.", image: true, align: true, removable: true },
  divider: { label: "Divider line", hint: "", color: true, removable: true },
  spacer: { label: "Space", hint: "", removable: true },
  footer: { label: "Footer", hint: "Always printed at the bottom of the page.", text: true, size: true, color: true, align: true, bold: true },
};

const ADDABLE: VoucherPdfBlockType[] = ["customText", "image", "divider", "spacer"];

const PAGE_SIZES = [
  { value: "a4", label: "A4 (210 × 297 mm)" },
  { value: "a5", label: "A5 (148 × 210 mm)" },
  { value: "a6", label: "A6 (105 × 148 mm)" },
];

function cloneLayout(layout: VoucherPdfLayout): VoucherPdfLayout {
  return { ...layout, blocks: layout.blocks.map((block) => ({ ...block })) };
}

function blockSummary(block: VoucherPdfBlock): string {
  if (block.type === "customText") return block.text?.trim().split("\n")[0]?.slice(0, 60) || "Empty text";
  if (block.type === "image") return block.src ? "Picture uploaded" : "No picture yet";
  if (block.type === "spacer") return `${block.height ?? 16} pt`;
  if (block.type === "headerImage") return block.src ? "Custom picture" : "From the event";
  return BLOCKS[block.type].hint;
}

export function VoucherPdfEditor({ initial, isCustom }: { initial: VoucherPdfLayout; isCustom: boolean }) {
  const [layout, setLayout] = useState(() => cloneLayout(initial));
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [custom, setCustom] = useState(isCustom);
  const [result, setResult] = useState<SettingsActionResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(layout) !== saved;

  const patchLayout = (patch: Partial<VoucherPdfLayout>) => setLayout((current) => ({ ...current, ...patch }));
  const patchBlock = (id: string, patch: Partial<VoucherPdfBlock>) =>
    setLayout((current) => ({ ...current, blocks: current.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)) }));

  function addBlock(type: VoucherPdfBlockType) {
    const id = `${type}-${Date.now().toString(36)}`;
    const base: VoucherPdfBlock = { id, type, enabled: true };
    const block: VoucherPdfBlock =
      type === "customText" ? { ...base, text: "", fontSize: 11 } : type === "spacer" ? { ...base, height: 24 } : type === "image" ? { ...base, height: 90 } : base;
    // New blocks go just above the footer, where there is room to see them.
    setLayout((current) => {
      const footer = current.blocks.findIndex((b) => b.type === "footer");
      const at = footer < 0 ? current.blocks.length : footer;
      const blocks = [...current.blocks];
      blocks.splice(at, 0, block);
      return { ...current, blocks };
    });
    setOpen(id);
  }

  function move(id: string, direction: -1 | 1) {
    setLayout((current) => {
      const blocks = [...current.blocks];
      const from = blocks.findIndex((block) => block.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= blocks.length) return current;
      [blocks[from], blocks[to]] = [blocks[to]!, blocks[from]!];
      return { ...current, blocks };
    });
  }

  function save() {
    startTransition(async () => {
      const outcome = await saveVoucherPdfLayoutAction(JSON.stringify(layout));
      setResult(outcome);
      if (outcome.ok) {
        setSaved(JSON.stringify(layout));
        setCustom(true);
      }
    });
  }

  function reset() {
    startTransition(async () => {
      const outcome = await saveVoucherPdfLayoutAction(null);
      setResult(outcome);
      if (outcome.ok) {
        const fresh = cloneLayout(DEFAULT_VOUCHER_PDF_LAYOUT);
        setLayout(fresh);
        setSaved(JSON.stringify(fresh));
        setCustom(false);
      }
    });
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,520px)]">
      <div className="grid gap-6">
        <SectionCard title="Page" description="Applies to every ticket your organization issues.">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Page size" htmlFor="pageSize">
                <NativeSelect id="pageSize" value={layout.pageSize} onChange={(e) => patchLayout({ pageSize: e.target.value as VoucherPdfLayout["pageSize"] })}>
                  {PAGE_SIZES.map((size) => (
                    <option key={size.value} value={size.value}>
                      {size.label}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Margin (pt)" htmlFor="margin">
                <Input id="margin" type="number" min={12} max={120} value={layout.margin} onChange={(e) => patchLayout({ margin: Number(e.target.value) || 0 })} />
              </FormField>
              <FormField label="Accent colour" htmlFor="primaryColor" hint="Event name colour.">
                <ColorInput id="primaryColor" value={layout.primaryColor} onChange={(primaryColor) => patchLayout({ primaryColor })} />
              </FormField>
              <FormField label="Header image height (pt)" htmlFor="headerHeight">
                <Input id="headerHeight" type="number" min={20} max={400} value={layout.headerHeight} onChange={(e) => patchLayout({ headerHeight: Number(e.target.value) || 0 })} />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Page colour" htmlFor="backgroundColor" hint="Empty = white.">
                <ColorInput id="backgroundColor" optional value={layout.backgroundColor} onChange={(backgroundColor) => patchLayout({ backgroundColor })} />
              </FormField>
              <FormField label="Frame colour" htmlFor="borderColor" hint="Empty = no frame.">
                <ColorInput id="borderColor" optional value={layout.borderColor} onChange={(borderColor) => patchLayout({ borderColor })} />
              </FormField>
              <FormField label="Frame thickness (pt)" htmlFor="borderWidth">
                <Input id="borderWidth" type="number" min={0} max={20} step="0.5" value={layout.borderWidth} onChange={(e) => patchLayout({ borderWidth: Number(e.target.value) || 0 })} />
              </FormField>
              <FormField label="Page numbers" htmlFor="showPageNumbers">
                <div className="flex h-9 items-center">
                  <Switch id="showPageNumbers" checked={layout.showPageNumbers} onCheckedChange={(showPageNumbers) => patchLayout({ showPageNumbers })} />
                </div>
              </FormField>
            </div>
            <FormField label="Background picture" hint="Fills the whole page behind the text. Light, low-contrast artwork keeps the QR code scannable.">
              <ImageField value={layout.backgroundImage} onChange={(backgroundImage) => patchLayout({ backgroundImage })} />
            </FormField>
          </div>
        </SectionCard>

        <SectionCard
          title="Ticket content"
          description="Blocks print top to bottom in this order. Open one to restyle it; move it with the arrows."
          actions={
            <div className="flex flex-wrap gap-2">
              {ADDABLE.map((type) => (
                <Button key={type} type="button" variant="outline" size="sm" onClick={() => addBlock(type)}>
                  <Plus /> {BLOCKS[type].label}
                </Button>
              ))}
            </div>
          }
        >
          <ul className="divide-y rounded-lg border">
            {layout.blocks.map((block, index) => {
              const meta = BLOCKS[block.type];
              const expanded = open === block.id;
              const locked = block.type === "qrCode";
              return (
                <li key={block.id}>
                  <div className="flex items-center gap-2 p-2 pl-3">
                    <Switch aria-label={`Show ${meta.label}`} checked={block.enabled} disabled={locked} onCheckedChange={(enabled) => patchBlock(block.id, { enabled })} />
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(expanded ? null : block.id)}>
                      <span className={cn("grid min-w-0", !block.enabled && "opacity-50")}>
                        <span className="text-sm font-medium">{meta.label}</span>
                        <span className="text-muted-foreground truncate text-xs">{blockSummary(block)}</span>
                      </span>
                      <ChevronDown className={cn("text-muted-foreground ml-auto size-4 shrink-0 transition-transform", expanded && "rotate-180")} />
                    </button>
                    <Button type="button" variant="ghost" size="icon" aria-label="Move up" disabled={index === 0} onClick={() => move(block.id, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label="Move down" disabled={index === layout.blocks.length - 1} onClick={() => move(block.id, 1)}>
                      <ArrowDown />
                    </Button>
                    {meta.removable ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${meta.label}`}
                        onClick={() => setLayout((current) => ({ ...current, blocks: current.blocks.filter((b) => b.id !== block.id) }))}
                      >
                        <Trash2 />
                      </Button>
                    ) : (
                      <span className="size-9" aria-hidden />
                    )}
                  </div>
                  {expanded ? (
                    <div className="bg-muted/30 border-t p-4">
                      <BlockControls block={block} meta={meta} onChange={(patch) => patchBlock(block.id, patch)} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </SectionCard>

        <ResultNotice result={result} />
        <div className="bg-background/90 sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 border-t px-1 py-3 backdrop-blur">
          <Button type="button" onClick={save} disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save ticket layout"}
          </Button>
          {dirty ? <span className="text-muted-foreground text-sm">Unsaved changes</span> : null}
          {custom ? (
            <Button type="button" variant="ghost" className="ml-auto" onClick={reset} disabled={pending}>
              <RotateCcw /> Reset to default
            </Button>
          ) : null}
        </div>
      </div>

      <PdfPreview layout={layout} />
    </div>
  );
}

function BlockControls({ block, meta, onChange }: { block: VoucherPdfBlock; meta: BlockMeta; onChange: (patch: Partial<VoucherPdfBlock>) => void }) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const id = block.id;
  const isQr = block.type === "qrCode";

  /** Inserts a merge field where the cursor is in the text box. */
  function insertField(key: string) {
    const area = textRef.current;
    const token = `{{${key}}}`;
    const current = block.text ?? "";
    const at = area?.selectionStart ?? current.length;
    const end = area?.selectionEnd ?? at;
    onChange({ text: current.slice(0, at) + token + current.slice(end) });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  return (
    <div className="grid gap-4">
      {meta.image ? (
        <FormField label={block.type === "headerImage" ? "Picture (optional)" : "Picture"} hint={block.type === "headerImage" ? "Leave empty to use the image set on the event or group." : "PNG or JPEG, up to 5 MB."}>
          <ImageField value={block.src ?? ""} onChange={(src) => onChange({ src: src || undefined })} />
        </FormField>
      ) : null}

      {meta.text ? (
        <div className="grid gap-2">
          <FormField
            label={block.type === "footer" ? "Footer line" : "Text"}
            htmlFor={`${id}-text`}
            hint={block.type === "footer" ? "Replaces the default “present this QR code” line." : undefined}
          >
            <Textarea ref={textRef} id={`${id}-text`} rows={block.type === "footer" ? 2 : 4} value={block.text ?? ""} onChange={(e) => onChange({ text: e.target.value || undefined })} />
          </FormField>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Insert:</span>
            {VOUCHER_PDF_MERGE_FIELDS.map((field) => (
              <button
                key={field.key}
                type="button"
                title={field.label}
                onClick={() => insertField(field.key)}
                className="bg-background hover:bg-accent rounded-full border px-2 py-0.5 font-mono text-xs"
              >
                {`{{${field.key}}}`}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {block.type === "subtitle" ? (
        <FormField label="Caption above the name" htmlFor={`${id}-label`} hint="Empty hides it.">
          <Input id={`${id}-label`} value={block.label ?? "Résztvevő"} onChange={(e) => onChange({ label: e.target.value })} />
        </FormField>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        {meta.size ? (
          <FormField label="Size (pt)" htmlFor={`${id}-size`} className="w-24">
            <Input id={`${id}-size`} type="number" min={6} max={60} value={block.fontSize ?? ""} onChange={(e) => onChange({ fontSize: e.target.value ? Number(e.target.value) : undefined })} />
          </FormField>
        ) : null}
        {isQr ? (
          <FormField label="Size (pt)" htmlFor={`${id}-qr`} className="w-24" hint="60–320">
            <Input id={`${id}-qr`} type="number" min={60} max={320} value={block.width ?? 160} onChange={(e) => onChange({ width: Number(e.target.value) || undefined })} />
          </FormField>
        ) : null}
        {meta.image ? (
          <>
            <FormField label="Width (pt)" htmlFor={`${id}-w`} className="w-24" hint="Empty = fit">
              <Input id={`${id}-w`} type="number" min={0} max={600} value={block.width ?? ""} onChange={(e) => onChange({ width: e.target.value ? Number(e.target.value) : undefined })} />
            </FormField>
            <FormField label="Max height (pt)" htmlFor={`${id}-h`} className="w-28">
              <Input id={`${id}-h`} type="number" min={10} max={600} value={block.height ?? ""} onChange={(e) => onChange({ height: e.target.value ? Number(e.target.value) : undefined })} />
            </FormField>
          </>
        ) : null}
        {block.type === "spacer" ? (
          <FormField label="Height (pt)" htmlFor={`${id}-h`} className="w-28">
            <Input id={`${id}-h`} type="number" min={0} max={600} value={block.height ?? 16} onChange={(e) => onChange({ height: Number(e.target.value) || 0 })} />
          </FormField>
        ) : null}
        {block.type === "divider" ? (
          <FormField label="Thickness (pt)" htmlFor={`${id}-h`} className="w-28">
            <Input id={`${id}-h`} type="number" min={0.25} max={20} step="0.25" value={block.height ?? 0.5} onChange={(e) => onChange({ height: Number(e.target.value) || 0.5 })} />
          </FormField>
        ) : null}
        {meta.color ? (
          <FormField label="Colour" htmlFor={`${id}-color`} className="w-40">
            <ColorInput id={`${id}-color`} optional value={block.color ?? ""} onChange={(color) => onChange({ color: color || undefined })} />
          </FormField>
        ) : null}
        {meta.align ? (
          <FormField label="Align" htmlFor={`${id}-align`} className="w-28">
            <NativeSelect id={`${id}-align`} value={block.align ?? ""} onChange={(e) => onChange({ align: (e.target.value || undefined) as VoucherPdfBlock["align"] })}>
              <option value="">Default</option>
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </NativeSelect>
          </FormField>
        ) : null}
        {block.type !== "footer" && block.type !== "spacer" ? (
          <FormField label="Space below (pt)" htmlFor={`${id}-after`} className="w-32" hint="Empty = automatic">
            <Input id={`${id}-after`} type="number" min={0} max={200} value={block.spaceAfter ?? ""} onChange={(e) => onChange({ spaceAfter: e.target.value ? Number(e.target.value) : undefined })} />
          </FormField>
        ) : null}
        {meta.bold ? <CheckboxField label="Bold" checked={block.bold ?? false} onCheckedChange={(bold) => onChange({ bold: bold || undefined })} /> : null}
      </div>
    </div>
  );
}

/** Upload (or replace/remove) one picture; shows a thumbnail of what's set. */
function ImageField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = value.startsWith("/uploads/") ? `/admin/settings/voucher-pdf/asset?url=${encodeURIComponent(value)}` : value;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/admin/settings/voucher-pdf/upload", { method: "POST", body });
      const data = (await response.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!response.ok || !data.url) throw new Error(data.message ?? "Could not upload the image.");
      onChange(data.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload the image.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private, session-scoped upload; next/image can't fetch it
          <img src={preview} alt="" className="bg-muted h-16 max-w-40 rounded-md border object-contain" />
        ) : null}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} {value ? "Replace" : "Upload picture"}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            <X /> Remove
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ColorInput({ id, value, onChange, optional }: { id: string; value: string; onChange: (value: string) => void; optional?: boolean }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Pick a colour"
        className="border-input size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
        value={valid ? value : "#111827"}
        onChange={(e) => onChange(e.target.value)}
      />
      <Input id={id} value={value} placeholder={optional ? "Default" : "#111827"} onChange={(e) => onChange(e.target.value.trim())} className="font-mono" />
    </div>
  );
}

/** Re-renders a sample ticket from the layout as it is being edited, saved or not. */
function PdfPreview({ layout }: { layout: VoucherPdfLayout }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const current = useRef<string | null>(null);
  const body = JSON.stringify(layout);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/admin/settings/voucher-pdf/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        const next = URL.createObjectURL(await response.blob());
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = next;
        setUrl(next);
        setError(null);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not render the preview.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body]);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );

  return (
    <div className="xl:sticky xl:top-20">
      <SectionCard
        title="Preview"
        description="A sample ticket, updated as you edit."
        actions={loading ? <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label="Rendering" /> : null}
      >
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <div className="bg-muted aspect-[210/297] w-full overflow-hidden rounded-md border">
          {url ? <iframe title="Ticket preview" src={`${url}#toolbar=0&navpanes=0&view=Fit`} className="size-full" /> : null}
        </div>
      </SectionCard>
    </div>
  );
}
