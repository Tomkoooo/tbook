import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { AttendeeFieldDef, AttendeeFieldValue } from "@tbook/schemas";
import { DEFAULT_VOUCHER_PDF_LAYOUT, normalizeVoucherPdfLayout, type VoucherPdfLayout } from "@tbook/schemas";

/**
 * Ported from the legacy plugin's lib/voucher-pdf.ts. The renderer logic
 * (page layout math, per-block drawing, QR embedding, multi-page-per-
 * booking generation) is a close port of proven working code — not
 * redesigned. Two deliberate deviations:
 *
 * 1. The legacy version fetches its Unicode font (Roboto, needed for
 *    Hungarian double-acute accents ő/ű that the standard PDF fonts don't
 *    cover) from GitHub on every cold start, caching only in-memory per
 *    process. This rewrite vendors the font as a local asset
 *    (assets/fonts/Roboto-Regular.ttf) instead — no external network
 *    dependency at render time, deterministic, works offline, and doesn't
 *    re-fetch on every fresh container/serverless cold start. The font
 *    loader is still injectable (`loadFont` param) so tests never touch
 *    the filesystem/network unnecessarily.
 * 2. formatAttendeeFieldValue/formatEventSchedule are small local helpers
 *    here rather than a shared package export — packages/domain and
 *    packages/actions were out of scope for this pass; these are
 *    presentation-formatting helpers specific to this one renderer.
 */

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

function hexToRgb(hex: string) {
  const cleaned = hex.replace("#", "").trim();
  if (cleaned.length !== 6) return rgb(0.1, 0.1, 0.1);
  const n = Number.parseInt(cleaned, 16);
  if (!Number.isFinite(n)) return rgb(0.1, 0.1, 0.1);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0]!;
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) current = next;
    else {
      lines.push(current);
      current = words[i]!;
    }
  }
  lines.push(current);
  return lines;
}

function drawLines(page: PDFPage, font: PDFFont, lines: string[], x: number, y: number, fontSize: number, lineHeight: number, color = rgb(0.1, 0.1, 0.1)): number {
  let cursorY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursorY, size: fontSize, font, color });
    cursorY -= lineHeight;
  }
  return cursorY;
}

/** en/HU-agnostic date+time formatting for the schedule block — Hungarian by default, matching the legacy admin/PDF default locale. */
function formatEventSchedule(startDate: Date, endDate: Date, startTime?: string | null, endTime?: string | null): string {
  const fmt = (d: Date, time?: string | null) => {
    const datePart = d.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric" });
    return time ? `${datePart}, ${time}` : datePart;
  };
  return `${fmt(startDate, startTime)} – ${fmt(endDate, endTime)}`;
}

function formatAttendeeFieldValue(field: AttendeeFieldDef, value: AttendeeFieldValue | undefined): string {
  if (value == null || value === "") return "—";
  if (field.type === "select") {
    const choice = field.choices?.find((c) => c.value === String(value));
    return choice?.label ?? String(value);
  }
  return String(value);
}

/**
 * Resolved lazily (not at module scope) — confirmed necessary once apps/web
 * actually wired a route importing this module: Next's build-time page-data
 * collection evaluates every module a route transitively imports, and a
 * top-level `fileURLToPath(new URL(..., import.meta.url))` computed eagerly
 * there threw (`ERR_INVALID_ARG_TYPE`, a webpack-bundled `import.meta.url`
 * producing a URL instance from a different realm than Node's `url` module
 * expects). Deferring the resolution into a function means it only runs
 * when a voucher PDF is actually rendered, never during module evaluation.
 * TBOOK_FONT_PATH remains the escape hatch for a bundled path that still
 * doesn't resolve correctly at runtime; the Dockerfile's runner stage
 * copies packages/services/assets explicitly either way.
 */
function resolveVendoredFontPath(): string {
  return process.env.TBOOK_FONT_PATH || fileURLToPath(new URL("../assets/fonts/Roboto-Regular.ttf", import.meta.url));
}

let cachedFontBytes: Buffer | null = null;

/** Default font loader — reads the vendored TTF once, cached in-memory thereafter. Override in tests to avoid filesystem I/O. */
export async function loadDefaultVoucherFont(): Promise<Uint8Array> {
  if (!cachedFontBytes) cachedFontBytes = await readFile(resolveVendoredFontPath());
  return cachedFontBytes;
}

export type VoucherPdfPageInput = {
  token: string;
  displayName: string;
  attendeeFields: Record<string, AttendeeFieldValue>;
  attendeeFieldSchema: AttendeeFieldDef[];
  eventName: string;
  startDate: Date;
  endDate: Date;
  startTime?: string | null;
  endTime?: string | null;
  locationAddress: string;
  bookingId: string;
};

export type BuildVoucherPdfInput = {
  /** Header image bytes, already resolved by the caller (media storage lookup is outside this pure renderer's concern). */
  headerImageBytes?: { bytes: Uint8Array; isPng: boolean } | null;
  pages: VoucherPdfPageInput[];
  layout?: VoucherPdfLayout | null;
  /** Injectable for tests — defaults to the vendored local Roboto font. */
  loadFont?: () => Promise<Uint8Array>;
};

function findBlock(layout: VoucherPdfLayout, type: string) {
  return layout.blocks.find((b) => b.type === type && b.enabled !== false);
}

async function embedHeaderImage(pdf: PDFDocument, page: PDFPage, headerImageBytes: { bytes: Uint8Array; isPng: boolean }, margin: number, headerHeight: number): Promise<number> {
  const contentWidth = page.getWidth() - margin * 2;
  const y = page.getHeight() - margin;
  try {
    const embedded = headerImageBytes.isPng ? await pdf.embedPng(headerImageBytes.bytes) : await pdf.embedJpg(headerImageBytes.bytes);
    const scale = Math.min(contentWidth / embedded.width, headerHeight / embedded.height);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    page.drawImage(embedded, { x: margin + (contentWidth - w) / 2, y: y - h, width: w, height: h });
    return y - h - 16;
  } catch {
    return y;
  }
}

async function drawVoucherPage(pdf: PDFDocument, font: PDFFont, input: VoucherPdfPageInput, headerImageBytes: BuildVoucherPdfInput["headerImageBytes"], layout: VoucherPdfLayout, pageIndex: number, pageCount: number): Promise<void> {
  const margin = layout.margin;
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const contentWidth = page.getWidth() - margin * 2;
  const primary = hexToRgb(layout.primaryColor);
  let y = page.getHeight() - margin;

  if (findBlock(layout, "headerImage") && headerImageBytes) {
    y = await embedHeaderImage(pdf, page, headerImageBytes, margin, layout.headerHeight);
  }

  const titleBlock = findBlock(layout, "title");
  if (titleBlock) {
    const size = titleBlock.fontSize || layout.titleFontSize;
    y = drawLines(page, font, wrapText(input.eventName, font, size, contentWidth), margin, y, size, size + 4, titleBlock.color ? hexToRgb(titleBlock.color) : primary);
    y -= 8;
  }

  const scheduleBlock = findBlock(layout, "eventSchedule");
  if (scheduleBlock) {
    const size = scheduleBlock.fontSize || layout.bodyFontSize;
    y = drawLines(page, font, wrapText(formatEventSchedule(input.startDate, input.endDate, input.startTime, input.endTime), font, size, contentWidth), margin, y, size, size + 3, rgb(0.3, 0.3, 0.3));
  }

  const locationBlock = findBlock(layout, "location");
  if (locationBlock && input.locationAddress) {
    const size = locationBlock.fontSize || layout.bodyFontSize;
    y = drawLines(page, font, wrapText(input.locationAddress, font, size, contentWidth), margin, y, size, size + 3, rgb(0.3, 0.3, 0.3));
  }

  y -= 12;
  page.drawLine({ start: { x: margin, y }, end: { x: page.getWidth() - margin, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 20;

  // Participant name always shown (kept visible even if the subtitle block was disabled, matching the legacy behavior).
  y = drawLines(page, font, ["Résztvevő"], margin, y, 10, 12, rgb(0.45, 0.45, 0.45));
  y = drawLines(page, font, wrapText(input.displayName, font, 16, contentWidth), margin, y, 16, 20);

  if (findBlock(layout, "attendeeFields")) {
    for (const field of input.attendeeFieldSchema) {
      const value = input.attendeeFields[field.key];
      const formatted = formatAttendeeFieldValue(field, value);
      if (formatted === "—") continue;
      y = drawLines(page, font, wrapText(`${field.label}: ${formatted}`, font, 10, contentWidth), margin, y, 10, 13, rgb(0.35, 0.35, 0.35));
    }
  }

  for (const block of layout.blocks.filter((b) => b.type === "customText" && b.enabled !== false)) {
    if (!block.text?.trim()) continue;
    const size = block.fontSize || layout.bodyFontSize;
    y -= 8;
    y = drawLines(page, font, wrapText(block.text, font, size, contentWidth), margin, y, size, size + 3, block.color ? hexToRgb(block.color) : rgb(0.25, 0.25, 0.25));
  }

  y -= 16;

  if (findBlock(layout, "qrCode")) {
    const qrSize = 160;
    const qrPng = await QRCode.toBuffer(input.token, { type: "png", width: 400, margin: 1, errorCorrectionLevel: "M" });
    const qrImage = await pdf.embedPng(qrPng);
    page.drawImage(qrImage, { x: (page.getWidth() - qrSize) / 2, y: y - qrSize, width: qrSize, height: qrSize });
    y -= qrSize + 12;
  }

  const footerBlock = findBlock(layout, "footer");
  if (footerBlock || layout.showPageNumbers) {
    const shortToken = input.token.slice(0, 8).toUpperCase();
    const footerLines = [`Entry code: ${shortToken}`, `Foglalás: ${input.bookingId.slice(-8).toUpperCase()}`];
    if (layout.showPageNumbers) footerLines.push(`${pageIndex}/${pageCount}`);
    const customFooterText = footerBlock?.text?.trim();
    footerLines.push(customFooterText || "Mutassa be ezt a QR-kódot a beléptetésnél.");
    drawLines(page, font, footerLines, margin, margin + 36, footerBlock?.fontSize || 9, 12, rgb(0.5, 0.5, 0.5));
  }
}

/** Builds a multi-page voucher PDF — one page per guest. */
export async function buildVoucherPdf(input: BuildVoucherPdfInput): Promise<Uint8Array> {
  const loadFont = input.loadFont ?? loadDefaultVoucherFont;
  const fontBytes = await loadFont();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes);
  const layout = normalizeVoucherPdfLayout(input.layout ?? DEFAULT_VOUCHER_PDF_LAYOUT);

  const pageCount = input.pages.length;
  for (let i = 0; i < pageCount; i += 1) {
    await drawVoucherPage(pdf, font, input.pages[i]!, input.headerImageBytes, layout, i + 1, pageCount);
  }

  return pdf.save();
}
