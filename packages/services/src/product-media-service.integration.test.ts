import { MongoMemoryServer } from "mongodb-memory-server";
import sharp from "sharp";
import { BlobModel, OrganizationModel, ProductModel, StockMovementModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { productInputSchema } from "@tbook/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getBlob, parseMediaRef, putBlob, sweepUnreferencedBlobs } from "./blob-store";
import { readProductImageOriginal, readPublicProductImage, recropProductImage, storeProductImage } from "./product-media-service";
import { saveProduct } from "./product-service";
import { assertLayoutImages, readVoucherPdfAsset, storeVoucherPdfAsset } from "./voucher-pdf-assets";

describe("database blob store: product images, ticket assets, cleanup", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;
  let otherOrg: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });
  beforeEach(async () => {
    await Promise.all([OrganizationModel.deleteMany({}), ProductModel.deleteMany({}), StockMovementModel.deleteMany({}), BlobModel.deleteMany({})]);
    orgId = String((await OrganizationModel.create({ name: "Org", slug: "org", status: "active", settings: { currency: "HUF" } }))._id);
    otherOrg = String((await OrganizationModel.create({ name: "Other", slug: "other", status: "active", settings: { currency: "HUF" } }))._id);
  });

  const photo = () =>
    sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "secret-gps" } } })
      .toBuffer();
  const hashOf = (ref: string) => parseMediaRef(ref)!;

  it("stores a cropped ≤2000 px WebP without metadata, plus a capped original, under content hashes", async () => {
    const ref = await storeProductImage(orgId, await photo(), { x: 500, y: 0, width: 2000, height: 2000 });
    expect(ref).toMatch(/^\/media\/[a-f0-9]{64}\.webp$/);

    const served = await readPublicProductImage(hashOf(ref));
    const meta = await sharp(served!).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 2000, height: 2000 });
    expect(meta.exif).toBeUndefined();

    const original = await readProductImageOriginal(orgId, ref);
    expect(await sharp(original!).metadata()).toMatchObject({ format: "webp", width: 3000, height: 2000 });
  });

  it("deduplicates identical uploads and records every owner", async () => {
    const bytes = await photo();
    const a = await storeProductImage(orgId, bytes, null);
    const b = await storeProductImage(orgId, bytes, null);
    const c = await storeProductImage(otherOrg, bytes, null);
    expect(new Set([a, b, c]).size).toBe(1);
    expect(await BlobModel.countDocuments({})).toBe(2); // one image + one original
    expect((await getBlob(hashOf(a)))?.owners.sort()).toEqual([orgId, otherOrg].sort());
  });

  it("re-crops from the original, only for the owning organization", async () => {
    const first = await storeProductImage(orgId, await photo(), null);
    const second = await recropProductImage(orgId, first, { x: 0, y: 0, width: 1000, height: 500 });
    expect(second).not.toBe(first);
    expect(await sharp((await readPublicProductImage(hashOf(second)))!).metadata()).toMatchObject({ width: 1000, height: 500 });
    await expect(recropProductImage(otherOrg, first, { x: 0, y: 0, width: 10, height: 10 })).rejects.toThrow(/Only images uploaded here/);
    expect(await readProductImageOriginal(otherOrg, first)).toBeNull();
  });

  it("serves only processed product images publicly", async () => {
    const ref = await storeProductImage(orgId, await photo(), null);
    const original = (await getBlob(hashOf(ref)))!.derivedFrom!;
    expect(await readPublicProductImage(original)).toBeNull(); // the original stays private
    const invoice = await putBlob({ bytes: Buffer.from("%PDF-1.4 x"), contentType: "application/pdf", owner: orgId, kind: "invoice" });
    expect(await readPublicProductImage(invoice)).toBeNull();
    expect(await readPublicProductImage("../../etc/passwd")).toBeNull();
  });

  it("rejects files that aren't images", async () => {
    await expect(storeProductImage(orgId, Buffer.from("%PDF-1.4 not an image"), null)).rejects.toThrow(/isn't an image/);
  });

  it("keeps ticket assets per organization", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
    const { url } = await storeVoucherPdfAsset(orgId, png);
    expect(url).toMatch(/^\/media\/[a-f0-9]{64}\.png$/);
    expect((await readVoucherPdfAsset(orgId, url))?.contentType).toBe("image/png");
    expect(await readVoucherPdfAsset(otherOrg, url)).toBeNull();

    const layout = { backgroundImage: url, blocks: [] } as never;
    await expect(assertLayoutImages(orgId, layout)).resolves.toBeUndefined();
    await expect(assertLayoutImages(otherOrg, layout)).rejects.toThrow(/isn't one of your uploads/);
  });

  it("sanitizes the description and only accepts this organization's images", async () => {
    const own = await storeProductImage(orgId, await photo(), null);
    const input = productInputSchema.parse({
      name: "Bögre",
      priceGross: 3990,
      description: "<p>Kerámia <strong>bögre</strong></p><script>alert(1)</script><img src=x onerror=alert(1)>",
      images: [own, "https://cdn.example.com/a.jpg"],
      variants: [{ sku: "MUG", options: {} }],
    });
    const product = await saveProduct(orgId, null, input, "u");
    expect(product.description).toBe("<p>Kerámia <strong>bögre</strong></p>");
    expect(product.priceNet).toBe(3141.73);

    await expect(saveProduct(otherOrg, null, { ...input, variants: [{ ...input.variants[0]!, sku: "MUG2" }] }, "u")).rejects.toThrow(
      /uploaded to this organization/,
    );
    expect(productInputSchema.safeParse({ ...input, images: ["/uploads/vouchers/x.pdf"] }).success).toBe(false);
  });

  it("sweeps unreferenced blobs after the grace period, keeping referenced images and their originals", async () => {
    const kept = await storeProductImage(orgId, await photo(), null);
    const orphan = await storeProductImage(orgId, await sharp({ create: { width: 50, height: 50, channels: 3, background: "#00f" } }).png().toBuffer(), null);
    await saveProduct(orgId, null, productInputSchema.parse({ name: "Póló", priceGross: 1, images: [kept], variants: [{ sku: "P1", options: {} }] }), "u");

    // Within the grace period nothing goes (an unsaved form may still use it).
    expect(await sweepUnreferencedBlobs(new Date())).toBe(0);

    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await sweepUnreferencedBlobs(later)).toBe(2); // orphan image + its original
    expect(await readPublicProductImage(hashOf(kept))).not.toBeNull();
    expect(await readProductImageOriginal(orgId, kept)).not.toBeNull();
    expect(await readPublicProductImage(hashOf(orphan))).toBeNull();
  });
});
