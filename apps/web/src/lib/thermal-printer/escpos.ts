/**
 * Minimal ESC/POS byte builder — only the common, widely-supported subset
 * (not every printer-specific extension), since the exact command set
 * hasn't been verified against the real Xprinter yet. If text feeds but
 * the paper doesn't cut, try GS V 0 (partial cut) or ESC i instead of the
 * GS V 1 (full cut) used below. If accented characters print as boxes or
 * garbage, the printer's code page differs from the plain transliteration
 * fallback this uses — swap in an ESC t <n> code-page select once the
 * printer's supported table is confirmed on-site.
 */

const ESC = 0x1b;
const GS = 0x1d;

function textToBytes(text: string): Uint8Array {
  const stripped = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  let ascii = "";
  for (const char of stripped) ascii += char.codePointAt(0)! <= 0x7f ? char : "?";
  return new TextEncoder().encode(ascii);
}

export class EscPosBuilder {
  private readonly chunks: Uint8Array[] = [];

  init(): this {
    this.chunks.push(new Uint8Array([ESC, 0x40]));
    return this;
  }

  align(value: "left" | "center" | "right"): this {
    const n = value === "center" ? 1 : value === "right" ? 2 : 0;
    this.chunks.push(new Uint8Array([ESC, 0x61, n]));
    return this;
  }

  bold(on: boolean): this {
    this.chunks.push(new Uint8Array([ESC, 0x45, on ? 1 : 0]));
    return this;
  }

  textLine(text: string): this {
    this.chunks.push(textToBytes(text));
    this.chunks.push(new Uint8Array([0x0a]));
    return this;
  }

  feed(lines = 1): this {
    this.chunks.push(new Uint8Array([ESC, 0x64, lines]));
    return this;
  }

  cut(): this {
    this.chunks.push(new Uint8Array([GS, 0x56, 1]));
    return this;
  }

  build(): Uint8Array<ArrayBuffer> {
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** A minimal self-test print, so printer-settings.tsx can check the USB connection without a real sale. */
export function buildTestPrint(): Uint8Array<ArrayBuffer> {
  return new EscPosBuilder()
    .init()
    .align("center")
    .bold(true)
    .textLine("tbook printer test")
    .bold(false)
    .textLine(new Date().toLocaleString("hu-HU"))
    .feed(3)
    .cut()
    .build();
}
