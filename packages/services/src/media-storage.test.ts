import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStoredFile, storeFile } from "./media-storage";

describe("media-storage", () => {
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

  it("writes a file and returns a stable /uploads/ URL", async () => {
    const result = await storeFile(Buffer.from("hello pdf bytes"), { subdir: "vouchers", fileName: "booking-1.pdf" });
    expect(result.url).toBe("/uploads/vouchers/booking-1.pdf");

    const readBack = await readStoredFile(result.url);
    expect(readBack?.toString()).toBe("hello pdf bytes");
  });

  it("creates nested subdirectories as needed", async () => {
    const result = await storeFile(Buffer.from("x"), { subdir: "invoices/2026", fileName: "inv-1.pdf" });
    const readBack = await readStoredFile(result.url);
    expect(readBack?.toString()).toBe("x");
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
