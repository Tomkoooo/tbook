import QRCode from "qrcode";

/** Renders a login-confirmation URL as a data: PNG for the QR sign-in page to <img>-embed directly. */
export function generateLoginQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 280 });
}
