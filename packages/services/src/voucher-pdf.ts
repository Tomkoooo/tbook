import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { AttendeeFieldDef, AttendeeFieldValue } from "@tbook/schemas";
import { DEFAULT_VOUCHER_PDF_LAYOUT, normalizeVoucherPdfLayout, type VoucherPdfBlock, type VoucherPdfLayout } from "@tbook/schemas";
import { getOwnedBlob, parseMediaRef } from "./blob-store";
import { readStoredFile } from "./media-storage";

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

type Align = "left" | "center" | "right";

function drawLines(page: PDFPage, font: PDFFont, lines: string[], x: number, y: number, fontSize: number, lineHeight: number, color = rgb(0.1, 0.1, 0.1), align: Align = "left", width = 0): number {
  let cursorY = y;
  for (const line of lines) {
    const slack = align === "left" || width <= 0 ? 0 : Math.max(width - font.widthOfTextAtSize(line, fontSize), 0);
    page.drawText(line, { x: x + (align === "center" ? slack / 2 : align === "right" ? slack : 0), y: cursorY, size: fontSize, font, color });
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

const VENDORED_FONT = path.join("packages", "services", "assets", "fonts", "Roboto-Regular.ttf");

/**
 * Where the vendored TTF lives on disk. Not derived from `import.meta.url`:
 * Next's webpack turns `new URL("../assets/…", import.meta.url)` into a
 * public asset URL (`static/media/Roboto-Regular.<hash>.ttf`), not a file
 * path, so production rendering failed ("Could not render the preview.").
 * Instead: TBOOK_FONT_PATH (set in the Dockerfile), else walk up from the
 * working directory to the repo root (/app in the image, the repo root or a
 * package dir in dev and tests).
 */
export function resolveVendoredFontPath(): string {
  if (process.env.TBOOK_FONT_PATH) return process.env.TBOOK_FONT_PATH;
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, VENDORED_FONT);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Voucher PDF font not found (${VENDORED_FONT} above ${process.cwd()}); set TBOOK_FONT_PATH.`);
}

let cachedFontBytes: Buffer | null = null;

/** Default font loader — reads the vendored TTF once, cached in-memory thereafter. Override in tests to avoid filesystem I/O. */
export async function loadDefaultVoucherFont(): Promise<Uint8Array> {
  if (!cachedFontBytes) cachedFontBytes = await readFile(resolveVendoredFontPath());
  return cachedFontBytes;
}

let cachedBoldFontBytes: Buffer | null = null;

/** Bold companion of the default font, for blocks an admin sets in bold. */
export async function loadDefaultVoucherBoldFont(): Promise<Uint8Array> {
  if (!cachedBoldFontBytes) {
    const regular = resolveVendoredFontPath();
    cachedBoldFontBytes = await readFile(regular.replace(/Roboto-Regular\.ttf$/, "Roboto-Bold.ttf"));
  }
  return cachedBoldFontBytes;
}

export type ResolvedImage = { bytes: Uint8Array; isPng: boolean };

/**
 * Reads a picture for the ticket PDF: an organization's uploaded asset
 * (`/media/<hash>.png|jpg`, only when `organizationId` owns it), a legacy
 * `/uploads/…` file, or an absolute http(s) image. Null when unreadable.
 */
export async function resolveVoucherImage(url: string, organizationId?: string | null): Promise<ResolvedImage | null> {
  const trimmed = url.trim();
  try {
    let bytes: Uint8Array | null = null;
    const hash = parseMediaRef(trimmed);
    if (hash) bytes = organizationId ? ((await getOwnedBlob(organizationId, hash, "ticket-asset"))?.data ?? null) : null;
    else if (trimmed.startsWith("/uploads/")) bytes = await readStoredFile(trimmed);
    else if (/^https?:\/\//.test(trimmed)) {
      const res = await fetch(trimmed);
      if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
    }
    if (!bytes || bytes.length < 4) return null;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    return isPng || isJpg ? { bytes, isPng } : null;
  } catch {
    return null;
  }
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
  /** The day a day-pass entry is valid for (`yyyy-mm-dd`). */
  validDate?: string | null;
};

export type BuildVoucherPdfInput = {
  /** The event/group header image, already resolved by the caller. Used by the header block unless it has its own picture. */
  headerImageBytes?: ResolvedImage | null;
  pages: VoucherPdfPageInput[];
  layout?: VoucherPdfLayout | null;
  /** Injectable for tests — defaults to the vendored local Roboto font. */
  loadFont?: () => Promise<Uint8Array>;
  loadBoldFont?: () => Promise<Uint8Array>;
  /** Injectable image reader for block/background pictures. */
  loadImage?: (url: string) => Promise<ResolvedImage | null>;
};

const PAGE_SIZES = {
  a4: [A4_WIDTH, A4_HEIGHT],
  a5: [419.53, A4_WIDTH],
  a6: [297.64, 419.53],
} as const;

type Fonts = { regular: PDFFont; bold: PDFFont };
type ImageCache = Map<string, Promise<PDFImage | null>>;

const GREY = rgb(0.3, 0.3, 0.3);

function mergeText(template: string, input: VoucherPdfPageInput, pageIndex: number, pageCount: number): string {
  const schedule = formatEventSchedule(input.startDate, input.endDate, input.startTime, input.endTime);
  const values: Record<string, string> = {
    attendeeName: input.displayName,
    eventName: input.eventName,
    date: schedule,
    validDate: input.validDate ?? schedule,
    venue: input.locationAddress,
    bookingRef: input.bookingId.slice(-8).toUpperCase(),
    entryCode: input.token.slice(0, 8).toUpperCase(),
    page: String(pageIndex),
    pages: String(pageCount),
  };
  for (const field of input.attendeeFieldSchema) {
    values[field.key] ??= formatAttendeeFieldValue(field, input.attendeeFields[field.key]);
  }
  return template.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}

function wrapParagraphs(text: string, font: PDFFont, size: number, width: number): string[] {
  return text.split("\n").flatMap((line) => (line.trim() ? wrapText(line, font, size, width) : [""]));
}

async function embedImage(pdf: PDFDocument, cache: ImageCache, url: string, loadImage: (url: string) => Promise<ResolvedImage | null>): Promise<PDFImage | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = loadImage(url).then(async (found) => {
      if (!found) return null;
      try {
        return found.isPng ? await pdf.embedPng(found.bytes) : await pdf.embedJpg(found.bytes);
      } catch {
        return null;
      }
    });
    cache.set(url, pending);
  }
  return pending;
}

async function drawVoucherPage(
  pdf: PDFDocument,
  fonts: Fonts,
  input: VoucherPdfPageInput,
  headerImage: PDFImage | null,
  layout: VoucherPdfLayout,
  images: (url: string) => Promise<PDFImage | null>,
  pageIndex: number,
  pageCount: number,
): Promise<void> {
  const [pageWidth, pageHeight] = PAGE_SIZES[layout.pageSize];
  const page = pdf.addPage([pageWidth, pageHeight]);
  const margin = Math.min(layout.margin, pageWidth / 4);
  const contentWidth = pageWidth - margin * 2;
  const primary = hexToRgb(layout.primaryColor);
  const fontFor = (block?: VoucherPdfBlock) => (block?.bold ? fonts.bold : fonts.regular);

  if (/^#[0-9a-f]{6}$/i.test(layout.backgroundColor)) {
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: hexToRgb(layout.backgroundColor) });
  }
  if (layout.backgroundImage) {
    const background = await images(layout.backgroundImage);
    if (background) {
      // Cover the whole page, cropping the overflow evenly.
      const scale = Math.max(pageWidth / background.width, pageHeight / background.height);
      const w = background.width * scale;
      const h = background.height * scale;
      page.drawImage(background, { x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h });
    }
  }
  if (layout.borderWidth > 0 && /^#[0-9a-f]{6}$/i.test(layout.borderColor)) {
    const inset = Math.min(margin / 2, 20) + layout.borderWidth / 2;
    page.drawRectangle({
      x: inset,
      y: inset,
      width: pageWidth - inset * 2,
      height: pageHeight - inset * 2,
      borderColor: hexToRgb(layout.borderColor),
      borderWidth: layout.borderWidth,
    });
  }

  let y = pageHeight - margin;
  const gap = (block: VoucherPdfBlock, fallback: number) => {
    y -= block.spaceAfter ?? fallback;
  };

  const drawText = (block: VoucherPdfBlock, text: string, size: number, color: ReturnType<typeof rgb>, lineGap = 3) => {
    const font = fontFor(block);
    y = drawLines(page, font, wrapParagraphs(text, font, size, contentWidth), margin, y - size, size, size + lineGap, color, block.align, contentWidth) + size;
  };

  for (const block of layout.blocks) {
    if (block.enabled === false || block.type === "footer") continue;
    const size = block.fontSize || layout.bodyFontSize;

    switch (block.type) {
      case "headerImage": {
        const picture = block.src ? await images(block.src) : headerImage;
        if (!picture) break;
        const maxHeight = block.height || layout.headerHeight;
        const scale = Math.min((block.width || contentWidth) / picture.width, maxHeight / picture.height);
        const w = picture.width * scale;
        const h = picture.height * scale;
        const x = block.align === "left" ? margin : block.align === "right" ? margin + contentWidth - w : margin + (contentWidth - w) / 2;
        page.drawImage(picture, { x, y: y - h, width: w, height: h });
        y -= h;
        gap(block, 16);
        break;
      }
      case "image": {
        const picture = block.src ? await images(block.src) : null;
        if (!picture) break;
        const maxHeight = block.height || 120;
        const scale = Math.min((block.width || contentWidth) / picture.width, maxHeight / picture.height, contentWidth / picture.width);
        const w = picture.width * scale;
        const h = picture.height * scale;
        const x = block.align === "right" ? margin + contentWidth - w : block.align === "center" ? margin + (contentWidth - w) / 2 : margin;
        page.drawImage(picture, { x, y: y - h, width: w, height: h });
        y -= h;
        gap(block, 10);
        break;
      }
      case "title": {
        const titleSize = block.fontSize || layout.titleFontSize;
        drawText(block, input.eventName, titleSize, block.color ? hexToRgb(block.color) : primary, 4);
        gap(block, 8);
        break;
      }
      case "eventSchedule":
        drawText(block, formatEventSchedule(input.startDate, input.endDate, input.startTime, input.endTime), size, block.color ? hexToRgb(block.color) : GREY);
        gap(block, 2);
        break;
      case "location":
        if (!input.locationAddress) break;
        drawText(block, input.locationAddress, size, block.color ? hexToRgb(block.color) : GREY);
        gap(block, 2);
        break;
      case "divider": {
        y -= 6;
        const thickness = block.height || 0.5;
        page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness, color: block.color ? hexToRgb(block.color) : rgb(0.85, 0.85, 0.85) });
        y -= thickness;
        gap(block, 8);
        break;
      }
      case "spacer":
        y -= block.height ?? 16;
        break;
      case "subtitle": {
        const caption = block.label ?? "Résztvevő";
        if (caption) {
          y = drawLines(page, fonts.regular, [caption], margin, y - 10, 10, 12, rgb(0.45, 0.45, 0.45), block.align, contentWidth) + 10;
        }
        const nameSize = block.fontSize || 16;
        drawText(block, input.displayName, nameSize, block.color ? hexToRgb(block.color) : rgb(0.1, 0.1, 0.1), 4);
        gap(block, 6);
        break;
      }
      case "attendeeFields": {
        for (const field of input.attendeeFieldSchema) {
          const formatted = formatAttendeeFieldValue(field, input.attendeeFields[field.key]);
          if (formatted === "—") continue;
          drawText(block, `${field.label}: ${formatted}`, block.fontSize || 10, block.color ? hexToRgb(block.color) : rgb(0.35, 0.35, 0.35), 3);
        }
        gap(block, 6);
        break;
      }
      case "qrCode": {
        const qrSize = Math.min(Math.max(block.width || 160, 60), Math.min(contentWidth, 320));
        const qrPng = await QRCode.toBuffer(input.token, { type: "png", width: 400, margin: 1, errorCorrectionLevel: "M" });
        const qrImage = await pdf.embedPng(qrPng);
        const qrX = block.align === "left" ? margin : block.align === "right" ? pageWidth - margin - qrSize : (pageWidth - qrSize) / 2;
        page.drawImage(qrImage, { x: qrX, y: y - qrSize, width: qrSize, height: qrSize });
        y -= qrSize;
        gap(block, 12);
        break;
      }
      case "customText": {
        if (!block.text?.trim()) break;
        drawText(block, mergeText(block.text, input, pageIndex, pageCount), size, block.color ? hexToRgb(block.color) : rgb(0.25, 0.25, 0.25));
        gap(block, 8);
        break;
      }
      default:
        break;
    }
  }

  const footerBlock = layout.blocks.find((b) => b.type === "footer" && b.enabled !== false);
  if (footerBlock || layout.showPageNumbers) {
    const shortToken = input.token.slice(0, 8).toUpperCase();
    const footerLines = [`Entry code: ${shortToken}`, `Foglalás: ${input.bookingId.slice(-8).toUpperCase()}`];
    if (layout.showPageNumbers) footerLines.push(`${pageIndex}/${pageCount}`);
    const customFooterText = footerBlock?.text?.trim();
    footerLines.push(customFooterText ? mergeText(customFooterText, input, pageIndex, pageCount) : "Mutassa be ezt a QR-kódot a beléptetésnél.");
    drawLines(page, fontFor(footerBlock), footerLines, margin, margin + 36, footerBlock?.fontSize || 9, 12, footerBlock?.color ? hexToRgb(footerBlock.color) : rgb(0.5, 0.5, 0.5), footerBlock?.align, contentWidth);
  }
}

/** Builds a multi-page voucher PDF — one page per guest. */
export async function buildVoucherPdf(input: BuildVoucherPdfInput): Promise<Uint8Array> {
  const loadFont = input.loadFont ?? loadDefaultVoucherFont;
  const loadBoldFont = input.loadBoldFont ?? (input.loadFont ? input.loadFont : loadDefaultVoucherBoldFont);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await pdf.embedFont(await loadFont(), { subset: true }),
    bold: await pdf.embedFont(await loadBoldFont(), { subset: true }),
  };
  const layout = normalizeVoucherPdfLayout(input.layout ?? DEFAULT_VOUCHER_PDF_LAYOUT);

  const cache: ImageCache = new Map();
  const loadImage = input.loadImage ?? ((url: string) => resolveVoucherImage(url, null));
  const images = (url: string) => embedImage(pdf, cache, url, loadImage);
  const headerImage = input.headerImageBytes
    ? await embedImage(pdf, cache, "\0header", async () => input.headerImageBytes ?? null)
    : null;

  const pageCount = input.pages.length;
  for (let i = 0; i < pageCount; i += 1) {
    await drawVoucherPage(pdf, fonts, input.pages[i]!, headerImage, layout, images, i + 1, pageCount);
  }

  return pdf.save();
}
