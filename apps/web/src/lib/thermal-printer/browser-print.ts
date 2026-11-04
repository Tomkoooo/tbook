import type { ReceiptSlip } from "./receipt-slip";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slipToHtml(slip: ReceiptSlip): string {
  const body = slip.lines
    .map((line) => {
      const style = [`text-align:${line.align === "center" ? "center" : "left"}`, line.bold ? "font-weight:bold" : ""].filter(Boolean).join(";");
      return `<div style="${style}">${escapeHtml(line.text) || "&nbsp;"}</div>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    @page { size: 58mm auto; margin: 2mm; }
    body { font-family: "Courier New", monospace; font-size: 11px; width: 54mm; margin: 0; }
  </style></head><body>${body}</body></html>`;
}

/**
 * Prints the slip through the OS's default printer via window.print().
 * Only dialog-free when the browser runs with a silent-printing flag
 * (desktop Chrome/Edge: --kiosk-printing) and the thermal printer is set
 * as the Windows default — a one-time setup on that laptop, not
 * something this code controls. On a plain browser this just opens the
 * normal print dialog, which is still a reasonable fallback.
 */
export function printSlipViaBrowser(slip: ReceiptSlip): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);
    const cleanup = () => iframe.remove();

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      cleanup();
      reject(new Error("Could not open the print window."));
      return;
    }

    doc.open();
    doc.write(slipToHtml(slip));
    doc.close();

    const finish = () => {
      cleanup();
      resolve();
    };
    win.addEventListener("afterprint", finish, { once: true });
    win.focus();
    win.print();
    // Not every browser fires afterprint for an iframe print — don't leave the iframe (or this promise) hanging if it doesn't.
    setTimeout(finish, 5000);
  });
}
