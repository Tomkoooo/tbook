/**
 * The content of the courtesy 58mm receipt slip — shared by both print
 * backends (webusb-printer.ts, browser-print.ts) so the slip reads the
 * same regardless of which device prints it. This is NOT the official
 * Hungarian "nyugta" (that's still issued through Számlázz.hu as an A4/80mm
 * PDF, packages/services/src/receipt-service.ts); it just references that
 * receipt's number.
 */

export interface ReceiptSlipItem {
  label: string;
  qty: number;
}

export interface ReceiptSlipLine {
  text: string;
  align?: "left" | "center";
  bold?: boolean;
}

export interface ReceiptSlip {
  lines: ReceiptSlipLine[];
}

export interface ReceiptSlipInput {
  eventName: string;
  items: ReceiptSlipItem[];
  totalHuf: number;
  currency: string;
  receiptNumber: string | null;
  printedAt: Date;
}

const RULE = "-".repeat(32);

function formatMoney(amount: number, currency: string): string {
  return `${amount.toLocaleString("hu-HU")} ${currency}`;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString("hu-HU", { dateStyle: "short", timeStyle: "short" });
}

export function buildReceiptSlip(input: ReceiptSlipInput): ReceiptSlip {
  const lines: ReceiptSlipLine[] = [];
  lines.push({ text: input.eventName, align: "center", bold: true });
  lines.push({ text: RULE });
  for (const item of input.items) {
    lines.push({ text: `${item.qty} x ${item.label}` });
  }
  lines.push({ text: RULE });
  lines.push({ text: `Total: ${formatMoney(input.totalHuf, input.currency)}`, bold: true });
  if (input.receiptNumber) lines.push({ text: `Receipt: ${input.receiptNumber}` });
  lines.push({ text: formatTimestamp(input.printedAt) });
  lines.push({ text: "" });
  lines.push({ text: "Thank you!", align: "center" });
  return { lines };
}
