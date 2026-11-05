"use client";

import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { getPairedBluetoothPrinter, isWebBluetoothSupported, printRawBluetooth, requestBluetoothPrinter } from "@/lib/thermal-printer/bluetooth-printer";
import { buildTestPrint } from "@/lib/thermal-printer/escpos";
import { printTestPageViaBrowser } from "@/lib/thermal-printer/browser-print";
import { getPrinterMode, getRasterWidth, setPrinterMode, setRasterWidth, type PrinterMode } from "@/lib/thermal-printer/printer-mode";
import { getPairedPrinter, isWebUsbSupported, printRaw, requestPrinter } from "@/lib/thermal-printer/webusb-printer";

const TRIGGER_LABEL: Record<PrinterMode, string> = { off: "Off", browser: "Browser", webusb: "USB", bluetooth: "Bluetooth" };

/** Per-device auto-print setup — see apps/web/src/lib/thermal-printer/. Lives next to the delivery toggle on the POS form. */
export function PrinterSettings() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PrinterMode>("off");
  const [rasterWidth, setRasterWidthState] = useState(400);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setMode(getPrinterMode());
    setRasterWidthState(getRasterWidth());
  }, []);

  function chooseMode(next: PrinterMode) {
    setMode(next);
    setPrinterMode(next);
    setStatus(null);
  }

  function changeRasterWidth(next: number) {
    if (!Number.isFinite(next) || next <= 0) return;
    setRasterWidthState(next);
    setRasterWidth(next);
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

  async function pairBluetoothPrinter() {
    setStatus(null);
    try {
      await requestBluetoothPrinter();
      chooseMode("bluetooth");
      setStatus("Printer connected.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not connect to the printer.");
    }
  }

  async function testPrint() {
    setStatus(null);
    try {
      if (mode === "webusb") {
        const device = await getPairedPrinter();
        if (!device) throw new Error("No USB printer is paired yet — connect it above first.");
        await printRaw(device, buildTestPrint());
      } else if (mode === "bluetooth") {
        const characteristic = await getPairedBluetoothPrinter();
        if (!characteristic) throw new Error("No Bluetooth printer is paired yet — connect it above first.");
        await printRawBluetooth(characteristic, buildTestPrint());
      } else if (mode === "browser") {
        await printTestPageViaBrowser();
      }
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
        <RadioGroup value={mode} onValueChange={(v) => (v === "off" || v === "browser") && chooseMode(v)} className="grid gap-3">
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
          {isWebBluetoothSupported() ? (
            <div className="flex items-center gap-2">
              <RadioGroupItem id="printer-bluetooth" value="bluetooth" disabled />
              <Label htmlFor="printer-bluetooth" className="font-normal">
                Bluetooth printer{mode === "bluetooth" ? " — connected" : ""}
              </Label>
            </div>
          ) : null}
        </RadioGroup>
        <div className="flex flex-wrap gap-2">
          {isWebUsbSupported() ? (
            <Button type="button" variant="outline" onClick={pairUsbPrinter}>
              {mode === "webusb" ? "Reconnect the USB printer" : "Connect a USB printer"}
            </Button>
          ) : null}
          {isWebBluetoothSupported() ? (
            <Button type="button" variant="outline" onClick={pairBluetoothPrinter}>
              {mode === "bluetooth" ? "Reconnect the Bluetooth printer" : "Connect a Bluetooth printer"}
            </Button>
          ) : null}
        </div>
        {mode === "webusb" || mode === "bluetooth" ? (
          <div className="flex items-center gap-2">
            <Label htmlFor="rasterWidth" className="font-normal">
              Raster width (dots)
            </Label>
            <Input
              id="rasterWidth"
              type="number"
              min={8}
              step={8}
              className="w-24"
              value={rasterWidth}
              onChange={(e) => changeRasterWidth(Number(e.target.value))}
            />
          </div>
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
