import { z } from "zod";

/**
 * Ported from the legacy plugin's lib/voucher-pdf-layout.ts. Stored per
 * organization (settings.voucherPdfLayout) — null means "use the default".
 *
 * This IS the "admins can fully edit the PDF" data model: every block is
 * independently toggleable (`enabled`), restylable (`fontSize`/`color`/
 * `align`), and reorderable (array order = render order), and `customText`
 * blocks let an admin add arbitrary extra text anywhere in the document.
 * The legacy plugin apparently once had an admin editor UI for this exact
 * schema and removed it; this rewrite ports the schema/renderer faithfully
 * and a later frontend phase builds the editor UI back on top of it.
 */

export const voucherPdfBlockTypes = [
  "headerImage",
  "title",
  "subtitle",
  "eventSchedule",
  "location",
  "attendeeFields",
  "qrCode",
  "customText",
  "footer",
] as const;
export const voucherPdfBlockTypeSchema = z.enum(voucherPdfBlockTypes);
export type VoucherPdfBlockType = z.infer<typeof voucherPdfBlockTypeSchema>;

export const voucherPdfBlockAlignSchema = z.enum(["left", "center", "right"]);

export const voucherPdfBlockSchema = z.object({
  id: z.string(),
  type: voucherPdfBlockTypeSchema,
  enabled: z.boolean().default(true),
  /** Only meaningful for `customText`. */
  text: z.string().optional(),
  fontSize: z.number().optional(),
  /** Hex color, e.g. #111827. */
  color: z.string().optional(),
  align: voucherPdfBlockAlignSchema.optional(),
});
export type VoucherPdfBlock = z.infer<typeof voucherPdfBlockSchema>;

export const voucherPdfLayoutSchema = z.object({
  margin: z.number().default(48),
  headerHeight: z.number().default(120),
  titleFontSize: z.number().default(20),
  bodyFontSize: z.number().default(11),
  primaryColor: z.string().default("#111827"),
  showPageNumbers: z.boolean().default(true),
  blocks: z.array(voucherPdfBlockSchema).default([]),
});
export type VoucherPdfLayout = z.infer<typeof voucherPdfLayoutSchema>;

export const DEFAULT_VOUCHER_PDF_LAYOUT: VoucherPdfLayout = {
  margin: 48,
  headerHeight: 120,
  titleFontSize: 20,
  bodyFontSize: 11,
  primaryColor: "#111827",
  showPageNumbers: true,
  blocks: [
    { id: "header", type: "headerImage", enabled: true },
    { id: "title", type: "title", enabled: true, fontSize: 20, align: "left" },
    { id: "subtitle", type: "subtitle", enabled: true, fontSize: 16 },
    { id: "schedule", type: "eventSchedule", enabled: true, fontSize: 11 },
    { id: "location", type: "location", enabled: true, fontSize: 11 },
    { id: "attendee", type: "attendeeFields", enabled: true, fontSize: 11 },
    { id: "qr", type: "qrCode", enabled: true, align: "center" },
    { id: "footer", type: "footer", enabled: true, fontSize: 9, color: "#6b7280" },
  ],
};

/**
 * Safe-parses a possibly partial/malformed/legacy layout, falling back to
 * `DEFAULT_VOUCHER_PDF_LAYOUT` field-by-field — mirrors the legacy plugin's
 * normalizeVoucherPdfLayout semantics (never throws on bad admin input or
 * pre-existing production data).
 */
export function normalizeVoucherPdfLayout(raw: unknown): VoucherPdfLayout {
  const base = DEFAULT_VOUCHER_PDF_LAYOUT;
  if (!raw || typeof raw !== "object") {
    return { ...base, blocks: base.blocks.map((b) => ({ ...b })) };
  }

  const input = raw as Partial<VoucherPdfLayout>;
  const parsedBlocks = Array.isArray(input.blocks)
    ? input.blocks
        .map((b) => voucherPdfBlockSchema.safeParse(b))
        .filter((r): r is { success: true; data: VoucherPdfBlock } => r.success)
        .map((r) => r.data)
    : [];

  return {
    margin: typeof input.margin === "number" ? input.margin : base.margin,
    headerHeight: typeof input.headerHeight === "number" ? input.headerHeight : base.headerHeight,
    titleFontSize: typeof input.titleFontSize === "number" ? input.titleFontSize : base.titleFontSize,
    bodyFontSize: typeof input.bodyFontSize === "number" ? input.bodyFontSize : base.bodyFontSize,
    primaryColor: typeof input.primaryColor === "string" ? input.primaryColor : base.primaryColor,
    showPageNumbers: input.showPageNumbers !== false,
    blocks: parsedBlocks.length > 0 ? parsedBlocks : base.blocks.map((b) => ({ ...b })),
  };
}

export const VOUCHER_PDF_BLOCK_LABELS: Record<VoucherPdfBlockType, string> = {
  headerImage: "Fejléckép",
  title: "Esemény neve",
  subtitle: "Résztvevő neve",
  eventSchedule: "Időpont",
  location: "Helyszín",
  attendeeFields: "Résztvevői adatok",
  qrCode: "QR kód",
  customText: "Egyedi szöveg",
  footer: "Lábléc / oldalszám",
};
