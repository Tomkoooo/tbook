import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Minimal local-filesystem media storage — no S3/cloud abstraction needed
 * yet. Writes under UPLOADS_DIR (default ./uploads), matching the
 * `/app/uploads` Docker volume already established in this repo's
 * Dockerfile/portainer.stack.tbook.example.yml (Phase 0). The legacy
 * plugin used a shared core MediaService; this rewrite doesn't have one
 * yet, so voucher/invoice PDFs get this small dedicated store instead.
 */

function uploadsRoot(): string {
  return process.env.UPLOADS_DIR || "./uploads";
}

export interface StoredFile {
  /** Stable relative URL an HTTP route can later serve this file at, e.g. /uploads/vouchers/<id>.pdf. */
  url: string;
  filePath: string;
}

export async function storeFile(buffer: Buffer | Uint8Array, opts: { subdir: string; fileName: string }): Promise<StoredFile> {
  const dir = path.join(uploadsRoot(), opts.subdir);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, opts.fileName);
  await writeFile(filePath, buffer);
  return { url: `/uploads/${opts.subdir}/${opts.fileName}`, filePath };
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
