/**
 * WebUSB is the only way to get a dialog-free print on an Android tablet
 * with the printer plugged in directly — unlike desktop Chrome/Edge
 * (--kiosk-printing flag), a regular consumer Android Chrome has no
 * silent-print mode, so browser-print.ts's window.print() always shows
 * the native Android print sheet there. Requires a secure context
 * (https, which tbook.sironic.hu already is).
 */

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

/**
 * Must be called directly inside a user click/tap handler — browsers
 * refuse requestDevice() otherwise. Deliberately unfiltered: Xprinter
 * clones don't share one vendor/product ID, and a wrong guess would
 * silently hide the real device from the picker. Once granted, the
 * browser remembers it — see getPairedPrinter().
 */
export function requestPrinter(): Promise<USBDevice> {
  return navigator.usb.requestDevice({ filters: [] });
}

/** Silently returns a previously-authorized device, or null if none was ever paired (or permission was revoked). */
export async function getPairedPrinter(): Promise<USBDevice | null> {
  const devices = await navigator.usb.getDevices();
  return devices[0] ?? null;
}

export async function printRaw(device: USBDevice, data: Uint8Array<ArrayBuffer>): Promise<void> {
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);

  let interfaceNumber: number | undefined;
  let endpointNumber: number | undefined;
  for (const iface of device.configuration?.interfaces ?? []) {
    const outEndpoint = iface.alternates.flatMap((alt) => alt.endpoints).find((ep) => ep.direction === "out");
    if (outEndpoint) {
      interfaceNumber = iface.interfaceNumber;
      endpointNumber = outEndpoint.endpointNumber;
      break;
    }
  }
  if (interfaceNumber === undefined || endpointNumber === undefined) {
    throw new Error("No USB OUT endpoint found on this device — is it really the printer?");
  }

  await device.claimInterface(interfaceNumber);
  try {
    await device.transferOut(endpointNumber, data);
  } finally {
    await device.close();
  }
}
