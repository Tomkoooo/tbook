/**
 * Which printer backend this specific device should use — per device, not
 * per organization, since the printer is physically attached to (or paired
 * with) one tablet/laptop, not shared org-wide. Same localStorage-per-
 * device pattern as sale-form.tsx's "tbook.pos.delivery".
 */

const MODE_KEY = "tbook.pos.printer";
const WIDTH_KEY = "tbook.pos.printer.rasterWidth";

/** Confirmed against the real Xprinter hardware — see printer-settings.tsx's "Test print". */
const DEFAULT_RASTER_WIDTH = 400;

export type PrinterMode = "off" | "webusb" | "bluetooth" | "browser";

export function getPrinterMode(): PrinterMode {
  try {
    const value = window.localStorage.getItem(MODE_KEY);
    if (value === "webusb" || value === "bluetooth" || value === "browser") return value;
  } catch {
    // localStorage unavailable (private mode, blocked storage, etc.) — auto-print just stays off.
  }
  return "off";
}

export function setPrinterMode(mode: PrinterMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Nothing to persist to — the choice just won't survive a reload.
  }
}

/** Dots per printed line for USB/Bluetooth raster printing — depends on the printer model, so it's a per-device setting rather than a fixed constant. */
export function getRasterWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  } catch {
    // Falls through to the default below.
  }
  return DEFAULT_RASTER_WIDTH;
}

export function setRasterWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Nothing to persist to — the choice just won't survive a reload.
  }
}
