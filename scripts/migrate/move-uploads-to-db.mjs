#!/usr/bin/env node
/**
 * Moves everything tBook still needs from the old uploads volume into the
 * database, so the volume can be removed.
 *
 * Irreplaceable files are copied into the content-addressed blob store
 * (`tbookblobs`, id = SHA-256 of the bytes) and references are rewritten to
 * `/media/<hash>.<ext>`:
 *   - product images (+ their originals, for re-cropping)
 *   - ticket PDF pictures (layout background/blocks, event/group header image)
 *   - manually attached invoice PDFs (not from Számlázz.hu)
 *
 * Regenerable files are not copied; only the stale path is cleared:
 *   - voucher PDFs (rendered on demand from the database)
 *   - Számlázz.hu invoice PDFs and receipt PDFs (downloaded from Számlázz.hu)
 *
 * Idempotent: blob ids are content hashes, and rewritten references no
 * longer match. Missing files are reported and their reference left as-is.
 *
 * Plain JS on the raw MongoDB driver (like the other migrate scripts).
 *
 * Usage:
 *   node scripts/migrate/move-uploads-to-db.mjs --dry-run
 *   UPLOADS_DIR=/app/uploads node scripts/migrate/move-uploads-to-db.mjs
 *
 * Flags:
 *   --dry-run          report what would change, write nothing
 *   --uri=<mongodb://> override DATABASE_URL
 *   --uploads=<dir>    override UPLOADS_DIR (default ./uploads)
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";

/**
 * Runs the migration against an open database. Exported for tests.
 * @param {import("mongodb").Db} db
 * @param {{ uploads: string, dryRun?: boolean, sharp?: any }} options
 */
export async function migrateUploads(db, { uploads, dryRun = false, sharp = null }) {
  const UPLOADS = path.resolve(uploads);
  const DRY = dryRun;
  const stats = { blobs: 0, reused: 0, rewritten: 0, cleared: 0, missing: [] };
  const blobs = db.collection("tbookblobs");

  async function readUpload(url) {
    if (!url?.startsWith("/uploads/")) return null;
    const file = path.resolve(UPLOADS, url.slice("/uploads/".length));
    if (!file.startsWith(UPLOADS + path.sep)) return null;
    try {
      return await readFile(file);
    } catch {
      stats.missing.push(url);
      return null;
    }
  }

  function sniff(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
    if (bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
    return "application/octet-stream";
  }
  const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

  async function putBlob(bytes, { owner, kind, derivedFrom = null }) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const contentType = sniff(bytes);
    if (DRY) return { hash, ref: `/media/${hash}.${EXT[contentType] ?? "bin"}` };
    const result = await blobs.updateOne(
      { _id: hash },
      {
        $setOnInsert: { data: bytes, contentType, size: bytes.length, derivedFrom, createdAt: new Date() },
        $addToSet: { owners: owner, kinds: kind },
      },
      { upsert: true },
    );
    if (result.upsertedCount) stats.blobs += 1;
    else stats.reused += 1;
    return { hash, ref: `/media/${hash}.${EXT[contentType] ?? "bin"}` };
  }

  async function normaliseSource(bytes) {
    if (!sharp) return bytes.length <= 15 * 1024 * 1024 ? bytes : null;
    return sharp(bytes).rotate().resize({ width: 4000, height: 4000, fit: "inside", withoutEnlargement: true }).webp({ quality: 92 }).toBuffer();
  }

  /** Rewrites one picture reference; returns the new value (or the old one if it can't move). */
  async function moveTicketAsset(url, owner) {
    if (!url?.startsWith("/uploads/")) return url;
    const bytes = await readUpload(url);
    if (!bytes || !owner) return url;
    return (await putBlob(bytes, { owner, kind: "ticket-asset" })).ref;
  }

  // ---- Product images ---------------------------------------------------------------
  for await (const product of db.collection("tbookproducts").find({ images: { $regex: "^/media/products/" } })) {
    const owner = String(product.organizationId);
    const images = [];
    for (const image of product.images) {
      const match = /^\/media\/products\/([A-Za-z0-9_-]+)\/([A-Za-z0-9]+)_[a-f0-9]+\.webp$/.exec(image);
      if (!match) {
        images.push(image);
        continue;
      }
      const [, org, id] = match;
      const processed = await readUpload(image.replace("/media/products/", "/uploads/products/"));
      if (!processed) {
        images.push(image);
        continue;
      }
      const original = await readUpload(`/uploads/products/${org}/${id}.src`);
      const source = original ? await normaliseSource(original) : null;
      const sourceHash = source ? (await putBlob(source, { owner, kind: "product-image-source" })).hash : null;
      images.push((await putBlob(processed, { owner, kind: "product-image", derivedFrom: sourceHash })).ref);
    }
    if (JSON.stringify(images) !== JSON.stringify(product.images)) {
      stats.rewritten += 1;
      if (!DRY) await db.collection("tbookproducts").updateOne({ _id: product._id }, { $set: { images } });
    }
  }

  // ---- Ticket PDF pictures ------------------------------------------------------------
  for await (const org of db.collection("tbookorganizations").find({ "settings.voucherPdfLayout": { $ne: null } })) {
    const layout = org.settings?.voucherPdfLayout;
    if (!layout) continue;
    const owner = String(org._id);
    const background = await moveTicketAsset(layout.backgroundImage, owner);
    const blocks = [];
    for (const block of layout.blocks ?? []) blocks.push(block.src ? { ...block, src: await moveTicketAsset(block.src, owner) } : block);
    if (background !== layout.backgroundImage || JSON.stringify(blocks) !== JSON.stringify(layout.blocks)) {
      stats.rewritten += 1;
      if (!DRY) {
        await db.collection("tbookorganizations").updateOne(
          { _id: org._id },
          { $set: { "settings.voucherPdfLayout.backgroundImage": background, "settings.voucherPdfLayout.blocks": blocks } },
        );
      }
    }
  }

  const groupOrg = new Map();
  for await (const group of db.collection("tbookeventgroups").find({}, { projection: { organizationId: 1, voucherHeaderImage: 1 } })) {
    groupOrg.set(String(group._id), group.organizationId ? String(group.organizationId) : null);
    if (group.voucherHeaderImage?.startsWith("/uploads/")) {
      const ref = await moveTicketAsset(group.voucherHeaderImage, group.organizationId ? String(group.organizationId) : null);
      if (ref !== group.voucherHeaderImage) {
        stats.rewritten += 1;
        if (!DRY) await db.collection("tbookeventgroups").updateOne({ _id: group._id }, { $set: { voucherHeaderImage: ref } });
      }
    }
  }
  for await (const event of db.collection("tbookevents").find({ voucherHeaderImage: { $regex: "^/uploads/" } })) {
    const owner = event.organizationId ? String(event.organizationId) : groupOrg.get(String(event.groupId)) ?? null;
    const ref = await moveTicketAsset(event.voucherHeaderImage, owner);
    if (ref !== event.voucherHeaderImage) {
      stats.rewritten += 1;
      if (!DRY) await db.collection("tbookevents").updateOne({ _id: event._id }, { $set: { voucherHeaderImage: ref } });
    }
  }

  // ---- Invoices and receipts -------------------------------------------------------------
  for await (const booking of db.collection("tbookbookings").find({ invoicePdfFileName: { $type: "string" } })) {
    const manual = booking.invoiceSource === "manual";
    const owner = booking.organizationId ? String(booking.organizationId) : null;
    if (manual) {
      const bytes = await readUpload(booking.invoicePdfFileName);
      if (!bytes || !owner) continue; // keep the path; reported as missing
      const { hash } = await putBlob(bytes, { owner, kind: "invoice" });
      stats.rewritten += 1;
      if (!DRY) await db.collection("tbookbookings").updateOne({ _id: booking._id }, { $set: { invoicePdfBlobId: hash, invoicePdfFileName: null } });
    } else {
      stats.cleared += 1; // Számlázz.hu keeps it
      if (!DRY) await db.collection("tbookbookings").updateOne({ _id: booking._id }, { $set: { invoicePdfFileName: null } });
    }
  }
  for (const [collection, field] of [
    ["tbookbookings", "receipt.pdfFileName"],
    ["tbookmerchsales", "receipt.pdfFileName"],
    ["tbookvouchers", "pdfFileName"],
  ]) {
    const filter = { [field]: { $type: "string" } };
    const count = await db.collection(collection).countDocuments(filter);
    stats.cleared += count;
    if (!DRY && count) await db.collection(collection).updateMany(filter, { $set: { [field]: null } });
  }
  return stats;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value ?? true];
    }),
  );
  const dryRun = Boolean(args["dry-run"]);
  const uri = args.uri || process.env.DATABASE_URL;
  if (!uri) {
    console.error("Set DATABASE_URL or pass --uri=…");
    process.exit(1);
  }
  let sharp = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.warn("sharp not available — image originals are stored as uploaded (max 15 MB).");
  }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const stats = await migrateUploads(client.db(), { uploads: args.uploads || process.env.UPLOADS_DIR || "./uploads", dryRun, sharp });
    console.log(`${dryRun ? "[dry run] " : ""}Done.`);
    console.log(`  blobs stored:        ${stats.blobs}${dryRun ? " (not written)" : ""}`);
    console.log(`  blobs already there: ${stats.reused}`);
    console.log(`  records rewritten:   ${stats.rewritten}`);
    console.log(`  stale paths cleared: ${stats.cleared} (vouchers, Számlázz.hu invoices, receipts — regenerated or fetched on demand)`);
    if (stats.missing.length) {
      console.log(`  MISSING files (references left unchanged): ${stats.missing.length}`);
      for (const url of stats.missing.slice(0, 50)) console.log(`    ${url}`);
    }
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
