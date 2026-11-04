/**
 * Which printer backend this specific device should use — per device, not
 * per organization, since the printer is physically attached to (or paired
 * with) one tablet/laptop, not shared org-wide. Same localStorage-per-
 * device pattern as sale-form.tsx's "tbook.pos.delivery".
 */

const STORAGE_KEY = "tbook.pos.printer";

export type PrinterMode = "off" | "webusb" | "browser";

export function getPrinterMode(): PrinterMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "webusb" || value === "browser") return value;
  } catch {
    // localStorage unavailable (private mode, blocked storage, etc.) — auto-print just stays off.
  }
  return "off";
}

export function setPrinterMode(mode: PrinterMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Nothing to persist to — the choice just won't survive a reload.
  }
}
