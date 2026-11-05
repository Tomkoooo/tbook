/**
 * Prints the real receipt PDF through the OS's default printer via
 * window.print(). Only dialog-free when the browser runs with a silent-
 * printing flag (desktop Chrome/Edge: --kiosk-printing) and the thermal
 * printer is set as the Windows default — a one-time setup on that laptop,
 * not something this code controls. On a plain browser this just opens the
 * normal print dialog, which is still a reasonable fallback.
 */
export function printPdfViaBrowser(pdfBytes: Uint8Array<ArrayBuffer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      iframe.remove();
    };
    const finish = () => {
      cleanup();
      resolve();
    };

    iframe.addEventListener("load", () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error("Could not print the receipt."));
      }
    });
    iframe.contentWindow?.addEventListener?.("afterprint", finish, { once: true });
    // Not every browser fires afterprint for an iframe print — don't leave the iframe (or this promise) hanging if it doesn't.
    setTimeout(finish, 10_000);
    iframe.src = url;
  });
}

/** A tiny one-line test page, so "Test print" doesn't need a real sale to check this device's printer setup. */
export function printTestPageViaBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
      @page { size: 58mm auto; margin: 2mm; }
      body { font-family: "Courier New", monospace; font-size: 11px; width: 54mm; margin: 0; text-align: center; }
    </style></head><body>tbook printer test<br />${new Date().toLocaleString("hu-HU")}</body></html>`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);
    const finish = () => {
      iframe.remove();
      resolve();
    };

    const doc = iframe.contentDocument;
    if (!doc) {
      finish();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    iframe.contentWindow?.addEventListener("afterprint", finish, { once: true });
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(finish, 5000);
  });
}
