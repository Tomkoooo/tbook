"use client";

import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { buildReceiptSlip } from "@/lib/thermal-printer/receipt-slip";
import { getPrinterMode, setPrinterMode, type PrinterMode } from "@/lib/thermal-printer/printer-mode";
import { printSlip } from "@/lib/thermal-printer/print-slip";
import { isWebUsbSupported, requestPrinter } from "@/lib/thermal-printer/webusb-printer";

const TRIGGER_LABEL: Record<PrinterMode, string> = { off: "Off", browser: "Browser", webusb: "USB" };

/** Per-device auto-print setup — see apps/web/src/lib/thermal-printer/. Lives next to the delivery toggle on the POS form. */
export function PrinterSettings() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PrinterMode>("off");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setMode(getPrinterMode());
  }, []);

  function chooseMode(next: PrinterMode) {
    setMode(next);
    setPrinterMode(next);
    setStatus(null);
  }

  async function pairUsbPrinter() {
    setStatus(null);
    try {
      await requestPrinter();
      chooseMode("webusb");
      setStatus("Printer connected.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not connect to the printer.");
    }
  }

  async function testPrint() {
    setStatus(null);
    try {
      await printSlip(
        buildReceiptSlip({
          eventName: "Test print",
          items: [{ label: "Sample ticket", qty: 1 }],
          totalHuf: 0,
          currency: "HUF",
          receiptNumber: null,
          printedAt: new Date(),
        }),
      );
      setStatus("Sent to the printer.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Printing failed.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Printer /> Printer: {TRIGGER_LABEL[mode]}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Automatic receipt printing</DialogTitle>
          <DialogDescription>Per device — this choice stays on this tablet or laptop only, right next to the usual Print receipt button.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={mode === "webusb" ? "webusb" : mode} onValueChange={(v) => chooseMode(v as PrinterMode)} className="grid gap-3">
          <div className="flex items-center gap-2">
            <RadioGroupItem id="printer-off" value="off" />
            <Label htmlFor="printer-off" className="cursor-pointer font-normal">
              Off — just the manual Print receipt button
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="printer-browser" value="browser" />
            <Label htmlFor="printer-browser" className="cursor-pointer font-normal">
              Browser printing (this device's default printer)
            </Label>
          </div>
          {isWebUsbSupported() ? (
            <div className="flex items-center gap-2">
              <RadioGroupItem id="printer-webusb" value="webusb" disabled />
              <Label htmlFor="printer-webusb" className="font-normal">
                USB printer{mode === "webusb" ? " — connected" : ""}
              </Label>
            </div>
          ) : null}
        </RadioGroup>
        {isWebUsbSupported() ? (
          <Button type="button" variant="outline" onClick={pairUsbPrinter}>
            {mode === "webusb" ? "Reconnect the USB printer" : "Connect a USB printer"}
          </Button>
        ) : null}
        {status ? <p className="text-muted-foreground text-sm">{status}</p> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={testPrint} disabled={mode === "off"}>
            Test print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
