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
  "image",
  "divider",
  "spacer",
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
  bold: z.boolean().optional(),
  /** `image`: an uploaded or absolute-URL picture; `headerImage`: overrides the event's header image when set. */
  src: z.string().max(1000).optional(),
  /** `image`: width in points (empty = as wide as fits); `qrCode`: side length. */
  width: z.number().min(0).max(600).optional(),
  /** `image`: maximum height; `spacer`: the gap; `divider`: line thickness. */
  height: z.number().min(0).max(600).optional(),
  /** Empty space under the block, in points. */
  spaceAfter: z.number().min(0).max(200).optional(),
  /** `subtitle`: the small caption above the guest's name; empty hides it. */
  label: z.string().max(100).optional(),
});
export type VoucherPdfBlock = z.infer<typeof voucherPdfBlockSchema>;

export const voucherPdfPageSizes = ["a4", "a5", "a6"] as const;
export const voucherPdfPageSizeSchema = z.enum(voucherPdfPageSizes);
export type VoucherPdfPageSize = z.infer<typeof voucherPdfPageSizeSchema>;

export const voucherPdfLayoutSchema = z.object({
  pageSize: voucherPdfPageSizeSchema.default("a4"),
  /** Hex page colour; empty = white. */
  backgroundColor: z.string().default(""),
  /** Full-page picture behind everything (uploaded or absolute URL); empty = none. */
  backgroundImage: z.string().max(1000).default(""),
  /** Hex colour of a frame around the page; empty or width 0 = no frame. */
  borderColor: z.string().default(""),
  borderWidth: z.number().min(0).max(20).default(0),
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
  pageSize: "a4",
  backgroundColor: "",
  backgroundImage: "",
  borderColor: "",
  borderWidth: 0,
  margin: 48,
  headerHeight: 120,
  titleFontSize: 20,
  bodyFontSize: 11,
  primaryColor: "#111827",
  showPageNumbers: true,
  blocks: [
    { id: "header", type: "headerImage", enabled: true },
    { id: "title", type: "title", enabled: true, fontSize: 20, align: "left" },
    { id: "schedule", type: "eventSchedule", enabled: true, fontSize: 11 },
    { id: "location", type: "location", enabled: true, fontSize: 11 },
    { id: "divider", type: "divider", enabled: true, spaceAfter: 14 },
    { id: "subtitle", type: "subtitle", enabled: true, fontSize: 16 },
    { id: "attendee", type: "attendeeFields", enabled: true, fontSize: 11 },
    { id: "qr", type: "qrCode", enabled: true, align: "center" },
    { id: "footer", type: "footer", enabled: true, fontSize: 9, color: "#6b7280" },
  ],
};

/** Merge fields an admin can put in any text block, e.g. `Welcome {{attendeeName}}!`. */
export const VOUCHER_PDF_MERGE_FIELDS = [
  { key: "attendeeName", label: "Guest name" },
  { key: "eventName", label: "Event name" },
  { key: "date", label: "Event date and time" },
  { key: "validDate", label: "Date of the pass (day passes)" },
  { key: "venue", label: "Venue address" },
  { key: "bookingRef", label: "Booking reference" },
  { key: "entryCode", label: "Short entry code" },
] as const;

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
    pageSize: voucherPdfPageSizeSchema.safeParse(input.pageSize).success ? (input.pageSize as VoucherPdfPageSize) : base.pageSize,
    backgroundColor: typeof input.backgroundColor === "string" ? input.backgroundColor : base.backgroundColor,
    backgroundImage: typeof input.backgroundImage === "string" ? input.backgroundImage : base.backgroundImage,
    borderColor: typeof input.borderColor === "string" ? input.borderColor : base.borderColor,
    borderWidth: typeof input.borderWidth === "number" ? input.borderWidth : base.borderWidth,
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
  image: "Kép",
  divider: "Elválasztó vonal",
  spacer: "Térköz",
  footer: "Lábléc / oldalszám",
};
