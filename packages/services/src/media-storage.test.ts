import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStoredFile } from "./media-storage";

describe("media-storage (read-only legacy uploads)", () => {
  let tempDir: string;
  let previousUploadsDir: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "tbook-media-test-"));
    previousUploadsDir = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = tempDir;
  });

  afterEach(async () => {
    process.env.UPLOADS_DIR = previousUploadsDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads a legacy file by its /uploads/ URL", async () => {
    await mkdir(path.join(tempDir, "invoices", "2026"), { recursive: true });
    await writeFile(path.join(tempDir, "invoices", "2026", "inv-1.pdf"), "hello pdf bytes");
    expect((await readStoredFile("/uploads/invoices/2026/inv-1.pdf"))?.toString()).toBe("hello pdf bytes");
  });

  it("returns null for a URL outside the /uploads/ namespace", async () => {
    expect(await readStoredFile("/etc/passwd")).toBeNull();
  });

  it("returns null for a missing file", async () => {
    expect(await readStoredFile("/uploads/vouchers/does-not-exist.pdf")).toBeNull();
  });

  it("rejects a path-traversal attempt that escapes the uploads root", async () => {
    expect(await readStoredFile("/uploads/../../etc/passwd")).toBeNull();
    expect(await readStoredFile("/uploads/vouchers/../../../etc/passwd")).toBeNull();
  });
});
