import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/** Renders a PDF's first page to a canvas scaled to the printer's dot width (printer-mode.ts's getRasterWidth() — depends on the printer model, so it's a per-device setting, not a fixed constant). */
export async function renderPdfPageToCanvas(pdfBytes: Uint8Array<ArrayBuffer>, dotsPerLine: number): Promise<HTMLCanvasElement> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: dotsPerLine / baseViewport.width });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context.");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Converts a rendered canvas into an ESC/POS raster bit-image command (GS v 0). */
export function canvasToEscPosRaster(canvas: HTMLCanvasElement, threshold = 160): Uint8Array<ArrayBuffer> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context.");
  const { width, height } = canvas;
  const widthBytes = Math.ceil(width / 8);
  const { data } = ctx.getImageData(0, 0, width, height);
  const raster = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3]!;
      const luminance = alpha === 0 ? 255 : 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      if (luminance < threshold) raster[y * widthBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }

  const ESC = 0x1b;
  const GS = 0x1d;
  const xL = widthBytes & 0xff;
  const xH = (widthBytes >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;
  const header = new Uint8Array([ESC, 0x40, GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
  const footer = new Uint8Array([ESC, 0x64, 3, GS, 0x56, 1]);

  const out = new Uint8Array(header.length + raster.length + footer.length);
  out.set(header, 0);
  out.set(raster, header.length);
  out.set(footer, header.length + raster.length);
  return out;
}
