/**
 * Web Bluetooth printing, for Xprinter (and similar) models sold with a BLE
 * module instead of/alongside USB. Uses the "generic ESC/POS over BLE" GATT
 * profile that most cheap thermal printers expose — not a universal
 * standard, so if a specific unit doesn't answer on this service/
 * characteristic, check that model's own documented UUIDs. Requires a
 * secure context, same as webusb-printer.ts.
 */

const PRINTER_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
const PRINTER_CHARACTERISTIC = "00002af1-0000-1000-8000-00805f9b34fb";

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

async function connectToDevice(device: BluetoothDevice): Promise<BluetoothRemoteGATTCharacteristic> {
  if (!device.gatt) throw new Error("This Bluetooth device has no GATT server.");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICE);
  return service.getCharacteristic(PRINTER_CHARACTERISTIC);
}

/**
 * Must be called directly inside a user click/tap handler — browsers
 * refuse requestDevice() otherwise. acceptAllDevices (rather than a name/
 * service filter) because these printers advertise under all sorts of
 * generic names; optionalServices is what actually grants access to the
 * printer service once paired.
 */
export async function requestBluetoothPrinter(): Promise<BluetoothRemoteGATTCharacteristic> {
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [PRINTER_SERVICE] });
  return connectToDevice(device);
}

/**
 * Silently reconnects to a previously-authorized device, or null if none
 * was ever paired — mirrors webusb-printer.ts's getPairedPrinter(). Needs
 * navigator.bluetooth.getDevices(), which isn't supported by every browser
 * that otherwise has Web Bluetooth; where it's missing this just means a
 * fresh "Connect" tap is needed each session.
 */
export async function getPairedBluetoothPrinter(): Promise<BluetoothRemoteGATTCharacteristic | null> {
  if (!isWebBluetoothSupported() || !("getDevices" in navigator.bluetooth)) return null;
  const devices = await navigator.bluetooth.getDevices();
  const device = devices[0];
  if (!device) return null;
  try {
    return await connectToDevice(device);
  } catch {
    return null;
  }
}

export async function printRawBluetooth(characteristic: BluetoothRemoteGATTCharacteristic, data: Uint8Array<ArrayBuffer>): Promise<void> {
  // BLE's effective write size is much smaller than USB's — chunk it to stay safely under typical negotiated MTUs.
  const chunkSize = 180;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    await characteristic.writeValue(data.slice(offset, offset + chunkSize));
  }
}
