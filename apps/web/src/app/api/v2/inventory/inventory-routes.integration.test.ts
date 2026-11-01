import { MongoMemoryServer } from "mongodb-memory-server";
import { OrganizationModel, ProductModel, StockMovementModel, StockReservationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { rotateInventoryApiKey } from "@tbook/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Route-level tests for the inventory API the webshop uses: the real
 * handlers, invoked with constructed Requests, against a real database.
 * Checks the contract documented in docs/inventory-api.md — auth, status
 * codes, envelopes and error codes. Stock rules have their own suite.
 */

const { GET: listProducts, POST: createProduct } = await import("./products/route");
const { PUT: updateProduct } = await import("./products/[productId]/route");
const { GET: getStock } = await import("./stock/route");
const { POST: reserve } = await import("./reservations/route");
const { POST: commit } = await import("./reservations/[reservationId]/commit/route");
const { POST: release } = await import("./reservations/[reservationId]/release/route");
const { POST: adjust } = await import("./stock/adjustments/route");

const BASE = "http://localhost/api/v2/inventory";
let key = "";

function req(path: string, init: { method?: string; body?: unknown; apiKey?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const apiKey = init.apiKey === undefined ? key : init.apiKey;
  if (apiKey) headers["x-tbook-api-key"] = apiKey;
  return new Request(`${BASE}${path}`, { method: init.method ?? "GET", headers, body: init.body ? JSON.stringify(init.body) : undefined });
}
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

const tee = {
  name: "Póló",
  status: "active",
  priceGross: 6990,
  variantOptions: [{ name: "Size", values: ["M", "L"] }],
  variants: [
    { sku: "TEE-M", options: { Size: "M" }, initialStock: 3 },
    { sku: "TEE-L", options: { Size: "L" }, initialStock: 1 },
  ],
};

describe("inventory API routes", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.DATABASE_URL = mongod.getUri();
    await dbConnect(mongod.getUri());
    await StockReservationModel.init();
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });
  beforeEach(async () => {
    await Promise.all([OrganizationModel.deleteMany({}), ProductModel.deleteMany({}), StockMovementModel.deleteMany({}), StockReservationModel.deleteMany({})]);
    const org = await OrganizationModel.create({ name: "Org", slug: "org", status: "active", settings: { currency: "HUF" } });
    key = (await rotateInventoryApiKey(String(org._id))).plaintext;
  });

  it("rejects missing and wrong keys with 401", async () => {
    expect((await listProducts(req("/products", { apiKey: null }))).status).toBe(401);
    const wrong = await listProducts(req("/products", { apiKey: "tbk_nope_nope_nope" }));
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe("unauthorized");
  });

  it("creates, lists and updates products in the { data, meta } envelope", async () => {
    const created = await createProduct(req("/products", { method: "POST", body: tee }));
    expect(created.status).toBe(200);
    const product = (await created.json()).data;
    expect(product.variants.map((v: { sku: string; available: number }) => [v.sku, v.available])).toEqual([["TEE-M", 3], ["TEE-L", 1]]);

    const list = await (await listProducts(req("/products"))).json();
    expect(list.meta.count).toBe(1);

    const draft = await updateProduct(
      req(`/products/${product.id}`, { method: "PUT", body: { ...tee, status: "draft", variants: product.variants.map((v: { id: string; sku: string; options: object }) => ({ id: v.id, sku: v.sku, options: v.options })) } }),
      params({ productId: product.id }),
    );
    expect(draft.status).toBe(200);
    expect((await (await listProducts(req("/products"))).json()).meta.count).toBe(0); // webshop list hides drafts
    expect((await (await listProducts(req("/products?status=all"))).json()).meta.count).toBe(1);

    const invalid = await createProduct(req("/products", { method: "POST", body: { name: "" } }));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("validation_error");
  });

  it("runs the checkout flow: reserve (201), retry (200), commit, and 409 on shortage", async () => {
    await createProduct(req("/products", { method: "POST", body: tee }));

    const first = await reserve(req("/reservations", { method: "POST", body: { reference: "order-1", items: [{ sku: "tee-m", quantity: 2 }] } }));
    expect(first.status).toBe(201);
    const reservation = (await first.json()).data;
    expect(reservation).toMatchObject({ reference: "order-1", status: "active", lines: [{ sku: "TEE-M", quantity: 2 }] });

    const retry = await reserve(req("/reservations", { method: "POST", body: { reference: "order-1", items: [{ sku: "TEE-M", quantity: 2 }] } }));
    expect(retry.status).toBe(200);
    expect((await retry.json()).data.id).toBe(reservation.id);

    const short = await reserve(req("/reservations", { method: "POST", body: { reference: "order-2", items: [{ sku: "TEE-M", quantity: 2 }] } }));
    expect(short.status).toBe(409);
    expect((await short.json()).error).toMatchObject({ code: "insufficient_stock", details: { sku: "TEE-M", requested: 2, available: 1 } });

    const committed = await commit(req("/reservations/order-1/commit", { method: "POST" }), params({ reservationId: "order-1" }));
    expect((await committed.json()).data.status).toBe("committed");
    const late = await release(req("/reservations/order-1/release", { method: "POST" }), params({ reservationId: "order-1" }));
    expect(late.status).toBe(409);

    const stock = (await (await getStock(req("/stock?sku=TEE-M"))).json()).data;
    expect(stock).toEqual([expect.objectContaining({ sku: "TEE-M", available: 1, reserved: 0, onHand: 1 })]);
  });

  it("adjusts stock and 404s an unknown SKU", async () => {
    await createProduct(req("/products", { method: "POST", body: tee }));
    const adjusted = await adjust(req("/stock/adjustments", { method: "POST", body: { sku: "TEE-L", delta: 10, reason: "delivery" } }));
    expect((await adjusted.json()).data).toMatchObject({ sku: "TEE-L", onHand: 11 });
    const unknown = await adjust(req("/stock/adjustments", { method: "POST", body: { sku: "NOPE", delta: 1 } }));
    expect(unknown.status).toBe(404);
  });
});
