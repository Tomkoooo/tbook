export function fmtValue(value: unknown): string {
  if (value === null || value === undefined) return "∅"; // ∅
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function printKeyValues(obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    console.log(`  ${key}: ${fmtValue(value)}`);
  }
}

export function table(rows: Array<Record<string, string>>, columns: string[]): string {
  if (rows.length === 0) return "(none)";
  const widths = columns.map((col) => Math.max(col.length, ...rows.map((row) => (row[col] ?? "").length)));
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i] ?? cell.length)).join("  ");
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...rows.map((row) => line(columns.map((c) => row[c] ?? "")))].join(
    "\n",
  );
}
