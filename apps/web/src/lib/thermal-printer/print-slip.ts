import { printSlipViaBrowser } from "./browser-print";
import { getPrinterMode } from "./printer-mode";
import type { ReceiptSlip } from "./receipt-slip";
import { renderSlipToEscPos } from "./escpos";
import { getPairedPrinter, printRaw } from "./webusb-printer";

/** Prints via whichever backend this device is configured for (printer-settings.tsx). A no-op when printing is off — that's a valid, common choice, not an error. */
export async function printSlip(slip: ReceiptSlip): Promise<void> {
  const mode = getPrinterMode();
  if (mode === "off") return;

  if (mode === "browser") {
    await printSlipViaBrowser(slip);
    return;
  }

  const device = await getPairedPrinter();
  if (!device) throw new Error("No USB printer is paired on this device yet — use Printer settings to connect it.");
  await printRaw(device, renderSlipToEscPos(slip));
}
