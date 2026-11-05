import { getPairedBluetoothPrinter, printRawBluetooth } from "./bluetooth-printer";
import { printPdfViaBrowser } from "./browser-print";
import { getPrinterMode, getRasterWidth } from "./printer-mode";
import { getPairedPrinter, printRaw } from "./webusb-printer";

/**
 * Prints the real receipt PDF via whichever backend this device is
 * configured for (printer-settings.tsx). A no-op when printing is off —
 * that's a valid, common choice, not an error.
 */
export async function printReceiptPdf(pdfBytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const mode = getPrinterMode();
  if (mode === "off") return;

  if (mode === "browser") {
    await printPdfViaBrowser(pdfBytes);
    return;
  }

  // USB and Bluetooth both print raw ESC/POS bytes, so they share the same
  // rasterization step; pdf.js (and its worker) are only pulled into the
  // bundle here, never for browser printing, which hands the PDF straight
  // to the OS instead.
  const { renderPdfPageToCanvas, canvasToEscPosRaster } = await import("./pdf-raster");
  const canvas = await renderPdfPageToCanvas(pdfBytes, getRasterWidth());
  const data = canvasToEscPosRaster(canvas);

  if (mode === "webusb") {
    const device = await getPairedPrinter();
    if (!device) throw new Error("No USB printer is paired on this device yet — use Printer settings to connect it.");
    await printRaw(device, data);
    return;
  }

  const characteristic = await getPairedBluetoothPrinter();
  if (!characteristic) throw new Error("No Bluetooth printer is paired on this device yet — use Printer settings to connect it.");
  await printRawBluetooth(characteristic, data);
}
