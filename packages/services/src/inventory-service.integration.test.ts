import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MerchSaleModel, OrganizationModel, ProductModel, StockMovementModel, StockReservationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { productInputSchema, type ProductInput } from "@tbook/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptOrgSecret } from "./org-secrets";
import {
  adjustStock,
  commitReservation,
  createReservation,
  expireReservations,
  getStockLevels,
  listStockMovements,
  recordReturn,
  recordSale,
  releaseReservation,
} from "./inventory-service";
import { resolveInventoryApiKey, rotateInventoryApiKey } from "./inventory-api-key";
import { createMerchSale } from "./merch-sale-service";
import { saveProduct } from "./product-service";

const tshirt = (overrides: Partial<ProductInput> = {}): ProductInput =>
  productInputSchema.parse({
    name: "Póló 2026",
    status: "active",
    priceGross: 6990,
    vatPercent: 27,
    variantOptions: [{ name: "Size", values: ["M", "L"] }],
    variants: [
      { sku: "tee-m", options: { Size: "M" }, initialStock: 5 },
      { sku: "tee-l", options: { Size: "L" }, priceGross: 7490, initialStock: 2 },
    ],
    ...overrides,
  });

describe("inventory", () => {
  let mongod: MongoMemoryServer;
  let orgId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
    await StockMovementModel.init();
    await StockReservationModel.init();
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });
  beforeEach(async () => {
    await Promise.all([
      OrganizationModel.deleteMany({}),
      ProductModel.deleteMany({}),
      StockMovementModel.deleteMany({}),
      StockReservationModel.deleteMany({}),
      MerchSaleModel.deleteMany({}),
    ]);
    orgId = String((await OrganizationModel.create({ name: "Org", slug: "org", status: "active", settings: { currency: "HUF" } }))._id);
  });

  const level = async (sku: string) => (await getStockLevels(orgId, [sku]))[0]!;

  it("creates products with uppercase SKUs, logs initial stock and keeps SKUs unique per org", async () => {
    const product = await saveProduct(orgId, null, tshirt(), "user-1");
    expect(product.variants.map((v) => [v.sku, v.available, v.priceGross, v.label])).toEqual([
      ["TEE-M", 5, 6990, "M"],
      ["TEE-L", 2, 7490, "L"],
    ]);
    expect((await listStockMovements(orgId)).map((m) => m.type)).toEqual(["initial", "initial"]);
    await expect(saveProduct(orgId, null, tshirt({ name: "Copy" }), "user-1")).rejects.toThrow(/SKU already used/);
  });

  it("keeps stock when a product is edited and refuses to delete a stocked variant", async () => {
    const product = await saveProduct(orgId, null, tshirt(), "u");
    await recordSale(orgId, { reference: "s1", items: [{ sku: "TEE-M", quantity: 2 }] });

    const edited = await saveProduct(
      orgId,
      product.id,
      tshirt({
        priceGross: 5990,
        variants: product.variants.map((v) => ({ id: v.id, sku: v.sku, options: v.options, priceGross: v.ownPriceGross, active: true, initialStock: 99 })),
      }),
      "u",
    );
    expect(edited.variants[0]!.available).toBe(3); // initialStock ignored for existing variants
    expect(edited.variants[0]!.priceGross).toBe(5990);

    const withoutL = tshirt({ variantOptions: [{ name: "Size", values: ["M"] }], variants: [{ id: product.variants[0]!.id, sku: "TEE-M", options: { Size: "M" }, priceGross: null, active: true, initialStock: 0 }] });
    await expect(saveProduct(orgId, product.id, withoutL, "u")).rejects.toThrow(/Can't delete TEE-L/);
  });

  it("reserves all-or-nothing and reports the shortage", async () => {
    await saveProduct(orgId, null, tshirt(), "u");
    const error = await createReservation(orgId, {
      reference: "cart-1",
      ttlSeconds: 600,
      items: [
        { sku: "TEE-M", quantity: 1 },
        { sku: "tee-l", quantity: 3 },
      ],
    }).catch((e) => e);
    expect(error.status).toBe(409);
    expect(error.code).toBe("insufficient_stock");
    expect(error.details).toEqual({ sku: "TEE-L", requested: 3, available: 2 });
    expect((await level("TEE-M")).available).toBe(5); // first line was put back
  });

  it("reserves, commits and is idempotent by reference", async () => {
    await saveProduct(orgId, null, tshirt(), "u");
    const first = await createReservation(orgId, { reference: "order-7", ttlSeconds: 600, items: [{ sku: "TEE-M", quantity: 2 }] });
    const again = await createReservation(orgId, { reference: "order-7", ttlSeconds: 600, items: [{ sku: "TEE-M", quantity: 2 }] });
    expect(again.created).toBe(false);
    expect(again.reservation.id).toBe(first.reservation.id);
    expect(await level("TEE-M")).toMatchObject({ available: 3, reserved: 2, onHand: 5 });

    await commitReservation(orgId, "order-7");
    await commitReservation(orgId, first.reservation.id); // repeat is a no-op
    expect(await level("TEE-M")).toMatchObject({ available: 3, reserved: 0, onHand: 3 });
    await expect(releaseReservation(orgId, "order-7")).rejects.toThrow(/already committed/);
  });

  it("releases on cancel and on expiry", async () => {
    await saveProduct(orgId, null, tshirt(), "u");
    await createReservation(orgId, { reference: "a", ttlSeconds: 600, items: [{ sku: "TEE-M", quantity: 1 }] });
    await releaseReservation(orgId, "a");
    expect((await level("TEE-M")).available).toBe(5);

    await createReservation(orgId, { reference: "b", ttlSeconds: 60, items: [{ sku: "TEE-M", quantity: 4 }] });
    expect(await expireReservations(orgId, new Date(Date.now() + 61_000))).toBe(1);
    expect(await level("TEE-M")).toMatchObject({ available: 5, reserved: 0 });
    await expect(commitReservation(orgId, "b")).rejects.toThrow(/expired/);

    // Paid after the hold lapsed: a direct sale under the same reference still works, once.
    const late = await recordSale(orgId, { reference: "b", items: [{ sku: "TEE-M", quantity: 4 }] });
    expect(late.sale.status).toBe("committed");
    expect((await recordSale(orgId, { reference: "b", items: [{ sku: "TEE-M", quantity: 4 }] })).created).toBe(false);
    expect((await level("TEE-M")).available).toBe(1);
  });

  it("never oversells under concurrent sales", async () => {
    await saveProduct(orgId, null, tshirt(), "u");
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => recordSale(orgId, { reference: `race-${i}`, items: [{ sku: "TEE-M", quantity: 1 }] })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect((await level("TEE-M")).available).toBe(0);
  });

  it("adjusts on-hand counts safely and applies returns once", async () => {
    await saveProduct(orgId, null, tshirt(), "u");
    await createReservation(orgId, { reference: "hold", ttlSeconds: 600, items: [{ sku: "TEE-M", quantity: 2 }] });

    await expect(adjustStock(orgId, { sku: "TEE-M", setOnHand: 1, reason: "count" }, "u")).rejects.toThrow(/reserved/);
    expect(await adjustStock(orgId, { sku: "TEE-M", setOnHand: 10, reason: "delivery" }, "u")).toMatchObject({ onHand: 10, available: 8 });
    await adjustStock(orgId, { sku: "TEE-M", delta: -1, reason: "damaged", idempotencyKey: "k1" }, "u");
    await adjustStock(orgId, { sku: "TEE-M", delta: -1, reason: "damaged", idempotencyKey: "k1" }, "u");
    expect((await level("TEE-M")).onHand).toBe(9);

    await recordReturn(orgId, { reference: "rma-1", items: [{ sku: "TEE-L", quantity: 1 }] });
    await recordReturn(orgId, { reference: "rma-1", items: [{ sku: "TEE-L", quantity: 1 }] });
    expect((await level("TEE-L")).available).toBe(3);
  });

  it("sells merch at the counter from the same stock, priced from the catalog, with a receipt", async () => {
    await saveProduct(orgId, null, tshirt(), "u");
    await OrganizationModel.updateOne({ _id: orgId }, { "settings.szamlazz": { enabled: true, agentKeyEnc: encryptOrgSecret("k") } });
    const uploads = await mkdtemp(path.join(tmpdir(), "tbook-merch-"));
    vi.stubEnv("UPLOADS_DIR", uploads);
    const provider = { createReceipt: vi.fn().mockResolvedValue({ number: "NYGTA-1", pdf: Buffer.from("%PDF") }), downloadReceiptPdf: vi.fn() };

    const sale = await createMerchSale(
      orgId,
      { lines: [{ sku: "tee-l", quantity: 1 }, { sku: "TEE-M", quantity: 2 }], paymentMethod: "card", paymentReference: "myPOS 4711" },
      { userId: "seller" },
      { provider },
    );
    expect(sale.totalGross).toBe(7490 + 2 * 6990);
    expect(sale.receipt).toMatchObject({ status: "issued", number: "NYGTA-1", hasPdf: true });
    expect(provider.createReceipt.mock.calls[0]![0].items.map((i: { label: string }) => i.label)).toEqual(["Póló 2026 (L)", "Póló 2026 (M)"]);
    expect(await level("TEE-M")).toMatchObject({ available: 3 });

    await expect(
      createMerchSale(orgId, { lines: [{ sku: "TEE-L", quantity: 5 }], paymentMethod: "cash" }, { userId: null }, { provider }),
    ).rejects.toMatchObject({ code: "insufficient_stock" });
    expect(await MerchSaleModel.countDocuments({})).toBe(1);

    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("resolves the organization from its inventory API key, and rotating revokes the old key", async () => {
    const { plaintext } = await rotateInventoryApiKey(orgId);
    expect(await resolveInventoryApiKey(plaintext)).toEqual({ organizationId: orgId });
    await rotateInventoryApiKey(orgId);
    await expect(resolveInventoryApiKey(plaintext)).rejects.toThrow(/Invalid/);
    await expect(resolveInventoryApiKey(null)).rejects.toThrow(/Missing/);
  });
});
