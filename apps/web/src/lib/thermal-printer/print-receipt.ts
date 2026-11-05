import { printPdfViaBrowser } from "./browser-print";
import { getPrinterMode } from "./printer-mode";
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

  const device = await getPairedPrinter();
  if (!device) throw new Error("No USB printer is paired on this device yet — use Printer settings to connect it.");
  // pdf.js (and its worker) are only pulled into the bundle for USB printing,
  // which needs to rasterize the PDF into an ESC/POS image; browser printing
  // hands the PDF straight to the OS instead.
  const { renderPdfPageToCanvas, canvasToEscPosRaster } = await import("./pdf-raster");
  const canvas = await renderPdfPageToCanvas(pdfBytes);
  await printRaw(device, canvasToEscPosRaster(canvas));
}
