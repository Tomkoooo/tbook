import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * READ-ONLY access to files from the old uploads volume (UPLOADS_DIR,
 * default ./uploads). Nothing writes here any more: uploads live in the
 * database blob store (blob-store.ts), voucher PDFs are rendered on
 * demand, and Számlázz.hu invoices/receipts are fetched from Számlázz.hu.
 *
 * Reads remain only as a fallback for records that still point at an
 * `/uploads/…` path. After `npm run migrate:uploads` has moved the
 * irreplaceable files into the database, the volume can be removed.
 */

function uploadsRoot(): string {
  return process.env.UPLOADS_DIR || "./uploads";
}

export async function readStoredFile(url: string): Promise<Buffer | null> {
  if (!url.startsWith("/uploads/")) return null;
  const root = path.resolve(uploadsRoot());
  const filePath = path.resolve(root, url.slice("/uploads/".length));
  // Reject any path that escapes the uploads root (e.g. /uploads/../../etc/passwd) — url may
  // eventually come from an untrusted route param once a guest-download endpoint exists.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null;
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}
