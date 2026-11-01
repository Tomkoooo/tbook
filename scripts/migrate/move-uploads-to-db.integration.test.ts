import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain JS migration script
import { migrateUploads } from "./move-uploads-to-db.mjs";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PDF = Buffer.from("%PDF-1.4 manual invoice");

describe("move-uploads-to-db", () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let uploads: string;
  const org = new ObjectId();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db("migrate-test");
  });
  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  let processed: Buffer;
  beforeEach(async () => {
    await db.dropDatabase();
    uploads = await mkdtemp(path.join(tmpdir(), "tbook-migrate-"));
    const orgId = String(org);
    processed = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#c00" } }).webp().toBuffer();
    const original = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#c00" } }).jpeg().toBuffer();
    await mkdir(path.join(uploads, "products", orgId), { recursive: true });
    await writeFile(path.join(uploads, "products", orgId, "abc123_ff00.webp"), processed);
    await writeFile(path.join(uploads, "products", orgId, "abc123.src"), original);
    await mkdir(path.join(uploads, "ticket-assets", orgId), { recursive: true });
    await writeFile(path.join(uploads, "ticket-assets", orgId, "logo.png"), PNG);
    await mkdir(path.join(uploads, "invoices"), { recursive: true });
    await writeFile(path.join(uploads, "invoices", "b1-manual.pdf"), PDF);

    await db.collection("tbookproducts").insertOne({ organizationId: org, images: [`/media/products/${orgId}/abc123_ff00.webp`, "https://cdn.example.com/x.jpg"] });
    await db.collection("tbookorganizations").insertOne({
      _id: org,
      settings: { voucherPdfLayout: { backgroundImage: "", blocks: [{ id: "logo", src: `/uploads/ticket-assets/${orgId}/logo.png` }, { id: "t" }] } },
    });
    await db.collection("tbookbookings").insertMany([
      { organizationId: org, invoiceSource: "manual", invoicePdfFileName: "/uploads/invoices/b1-manual.pdf" },
      { organizationId: org, invoiceSource: "szamlazz", invoicePdfFileName: "/uploads/invoices/SZ-1.pdf", receipt: { pdfFileName: "/uploads/receipts/N-1.pdf" } },
    ]);
    await db.collection("tbookvouchers").insertOne({ pdfFileName: "/uploads/vouchers/b1.pdf" });
    await db.collection("tbookevents").insertOne({ organizationId: org, voucherHeaderImage: "/uploads/ticket-assets/gone.png" });
    return () => rm(uploads, { recursive: true, force: true });
  });

  it("dry run writes nothing", async () => {
    const stats = await migrateUploads(db, { uploads, dryRun: true, sharp });
    expect(stats.rewritten).toBeGreaterThan(0);
    expect(await db.collection("tbookblobs").countDocuments()).toBe(0);
    expect((await db.collection("tbookproducts").findOne())?.images[0]).toMatch(/^\/media\/products\//);
  });

  it("moves irreplaceable files into blobs, rewrites references, clears regenerable paths, and is idempotent", async () => {
    const stats = await migrateUploads(db, { uploads, sharp });

    const product = await db.collection("tbookproducts").findOne();
    expect(product?.images).toEqual([`/media/${sha(processed)}.webp`, "https://cdn.example.com/x.jpg"]);
    const image = await db.collection("tbookblobs").findOne({ _id: sha(processed) as never });
    expect(image).toMatchObject({ kinds: ["product-image"], owners: [String(org)], contentType: "image/webp" });
    const source = await db.collection("tbookblobs").findOne({ _id: image?.derivedFrom });
    expect(source?.kinds).toEqual(["product-image-source"]);

    const orgDoc = await db.collection("tbookorganizations").findOne({ _id: org });
    expect(orgDoc?.settings.voucherPdfLayout.blocks[0].src).toBe(`/media/${sha(PNG)}.png`);
    expect(orgDoc?.settings.voucherPdfLayout.blocks[1]).toEqual({ id: "t" });

    const [manual, szamlazz] = await db.collection("tbookbookings").find().toArray();
    expect(manual).toMatchObject({ invoicePdfBlobId: sha(PDF), invoicePdfFileName: null });
    expect(szamlazz).toMatchObject({ invoicePdfFileName: null, receipt: { pdfFileName: null } });
    expect((await db.collection("tbookvouchers").findOne())?.pdfFileName).toBeNull();

    // A missing file is reported and its reference kept.
    expect(stats.missing).toEqual(["/uploads/ticket-assets/gone.png"]);
    expect((await db.collection("tbookevents").findOne())?.voucherHeaderImage).toBe("/uploads/ticket-assets/gone.png");

    const blobCount = await db.collection("tbookblobs").countDocuments();
    const again = await migrateUploads(db, { uploads, sharp });
    expect(again.blobs).toBe(0);
    expect(again.rewritten).toBe(0);
    expect(await db.collection("tbookblobs").countDocuments()).toBe(blobCount);
  });
});
