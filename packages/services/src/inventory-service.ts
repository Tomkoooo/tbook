import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { ProductModel, StockMovementModel, StockReservationModel, type IProduct, type IStockReservation } from "@tbook/db";
import type {
  CreateReservationInput,
  DirectSaleInput,
  ReturnInput,
  StockAdjustmentInput,
  StockLineInput,
  StockMovementType,
} from "@tbook/schemas";

/**
 * The shared warehouse. Every stock change is a single atomic update on
 * the variant, guarded so availability can never go negative — the
 * webshop (via the inventory API), the point of sale and the console can
 * sell the same T-shirt at the same moment without overselling.
 *
 * Per variant: `stock` = available to sell, `reserved` = held by open
 * reservations; on hand = stock + reserved.
 *
 *   reserve   stock −q, reserved +q   (webshop checkout started)
 *   commit    reserved −q             (paid — goods leave)
 *   release   stock +q, reserved −q   (cancelled / lapsed)
 *   sale      stock −q                (sold outright: counter, or webshop without a hold)
 *   return    stock +q
 *   adjust    stock ±q                (goods in, stock count, write-off)
 *
 * Multi-line operations are all-or-nothing: if a later line fails, the
 * lines already applied are reversed (compensation — MongoDB transactions
 * would need a replica set, which deployments don't guarantee).
 */

export interface StockLevel {
  sku: string;
  productId: string;
  variantId: string;
  available: number;
  reserved: number;
  onHand: number;
  active: boolean;
}

export interface ReservationView {
  id: string;
  reference: string;
  status: string;
  expiresAt: string;
  lines: Array<{ sku: string; quantity: number }>;
}

interface ResolvedLine {
  productId: Types.ObjectId;
  variantId: string;
  sku: string;
  quantity: number;
}

const oid = (id: string) => new Types.ObjectId(id);

/** Merges repeated SKUs (case-insensitive) so a line can't be checked twice against the same stock. */
function mergeLines(lines: StockLineInput[]): StockLineInput[] {
  const merged = new Map<string, StockLineInput>();
  for (const line of lines) {
    const key = line.sku.trim().toUpperCase();
    const existing = merged.get(key);
    merged.set(key, { sku: existing?.sku ?? line.sku.trim(), quantity: (existing?.quantity ?? 0) + line.quantity });
  }
  return [...merged.values()];
}

/** Finds the product + variant for each SKU in this organization. Unknown SKUs are a 404. */
export async function resolveSkus(organizationId: string, skus: string[]): Promise<Map<string, { product: IProduct; variantIndex: number }>> {
  const wanted = [...new Set(skus.map((s) => s.trim().toUpperCase()))];
  const products = await ProductModel.find({
    organizationId: oid(organizationId),
    // SKUs are stored uppercase (product-service), so this is an exact match.
    "variants.sku": { $in: wanted },
  }).exec();
  const found = new Map<string, { product: IProduct; variantIndex: number }>();
  for (const product of products) {
    product.variants.forEach((variant, variantIndex) => {
      const key = variant.sku.toUpperCase();
      if (wanted.includes(key)) found.set(key, { product, variantIndex });
    });
  }
  const missing = wanted.filter((sku) => !found.has(sku));
  if (missing.length > 0) throw ActionError.notFound(`Unknown SKU: ${missing.join(", ")}`);
  return found;
}

async function resolveLines(organizationId: string, lines: StockLineInput[]): Promise<ResolvedLine[]> {
  const merged = mergeLines(lines);
  const found = await resolveSkus(organizationId, merged.map((l) => l.sku));
  return merged.map((line) => {
    const { product, variantIndex } = found.get(line.sku.toUpperCase())!;
    const variant = product.variants[variantIndex]!;
    return { productId: product._id as Types.ObjectId, variantId: variant.id, sku: variant.sku, quantity: line.quantity };
  });
}

type Op = "take" | "reserve" | "commit" | "release" | "put";

/** One guarded atomic update. Returns false when the guard fails (not enough stock / reservation). */
async function applyOne(line: ResolvedLine, op: Op): Promise<boolean> {
  const q = line.quantity;
  const match: Record<string, unknown> = { id: line.variantId };
  let inc: Record<string, number>;
  switch (op) {
    case "take":
      match.stock = { $gte: q };
      match.active = true;
      inc = { "variants.$.stock": -q };
      break;
    case "reserve":
      match.stock = { $gte: q };
      match.active = true;
      inc = { "variants.$.stock": -q, "variants.$.reserved": q };
      break;
    case "commit":
      match.reserved = { $gte: q };
      inc = { "variants.$.reserved": -q };
      break;
    case "release":
      match.reserved = { $gte: q };
      inc = { "variants.$.stock": q, "variants.$.reserved": -q };
      break;
    case "put":
      inc = { "variants.$.stock": q };
      break;
  }
  const result = await ProductModel.updateOne({ _id: line.productId, variants: { $elemMatch: match } }, { $inc: inc }).exec();
  return result.modifiedCount === 1;
}

const INVERSE: Record<Op, Op | null> = { take: "put", reserve: "release", commit: null, release: null, put: "take" };

/** Applies every line or none: on a failure, already-applied lines are reversed. */
async function applyAll(organizationId: string, lines: ResolvedLine[], op: Op): Promise<void> {
  const applied: ResolvedLine[] = [];
  for (const line of lines) {
    if (await applyOne(line, op)) {
      applied.push(line);
      continue;
    }
    const inverse = INVERSE[op];
    if (inverse) for (const done of applied) await applyOne(done, inverse);
    if (op === "take" || op === "reserve") {
      const [level] = await getStockLevels(organizationId, [line.sku]);
      throw ActionError.conflict(`Not enough stock for ${line.sku}: ${line.quantity} requested, ${level?.available ?? 0} available.`, "insufficient_stock", {
        sku: line.sku,
        requested: line.quantity,
        available: level?.available ?? 0,
      });
    }
    throw ActionError.conflict(`Stock for ${line.sku} no longer matches this reservation.`, "reservation_mismatch", { sku: line.sku });
  }
}

async function logMovements(
  organizationId: string,
  lines: ResolvedLine[],
  type: StockMovementType,
  meta: { reference: string; actor: string; reason?: string; idempotencyKey?: string | null },
): Promise<void> {
  const deltas: Record<StockMovementType, (q: number) => { onHandDelta: number; availableDelta: number }> = {
    initial: (q) => ({ onHandDelta: q, availableDelta: q }),
    adjustment: (q) => ({ onHandDelta: q, availableDelta: q }),
    reservation: (q) => ({ onHandDelta: 0, availableDelta: -q }),
    reservation_release: (q) => ({ onHandDelta: 0, availableDelta: q }),
    reservation_commit: (q) => ({ onHandDelta: -q, availableDelta: 0 }),
    sale: (q) => ({ onHandDelta: -q, availableDelta: -q }),
    return: (q) => ({ onHandDelta: q, availableDelta: q }),
  };
  await StockMovementModel.insertMany(
    lines.map((line) => ({
      organizationId: oid(organizationId),
      productId: line.productId,
      variantId: line.variantId,
      sku: line.sku,
      type,
      ...deltas[type](line.quantity),
      reference: meta.reference,
      reason: meta.reason ?? "",
      actor: meta.actor,
      idempotencyKey: meta.idempotencyKey ?? null,
    })),
  );
}

// ---- Reads ---------------------------------------------------------------------

export async function getStockLevels(organizationId: string, skus?: string[]): Promise<StockLevel[]> {
  const filter: Record<string, unknown> = { organizationId: oid(organizationId) };
  const products = await ProductModel.find(filter).exec();
  const wanted = skus ? new Set(skus.map((s) => s.trim().toUpperCase())) : null;
  return products.flatMap((product) =>
    product.variants
      .filter((variant) => !wanted || wanted.has(variant.sku.toUpperCase()))
      .map((variant) => ({
        sku: variant.sku,
        productId: String(product._id),
        variantId: variant.id,
        available: variant.stock,
        reserved: variant.reserved,
        onHand: variant.stock + variant.reserved,
        active: variant.active && product.status === "active",
      })),
  );
}

export async function listStockMovements(organizationId: string, opts: { sku?: string; productId?: string; limit?: number } = {}) {
  const filter: Record<string, unknown> = { organizationId: oid(organizationId) };
  if (opts.productId && Types.ObjectId.isValid(opts.productId)) filter.productId = oid(opts.productId);
  if (opts.sku) filter.sku = opts.sku.trim().toUpperCase();
  const rows = await StockMovementModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
    .exec();
  return rows.map((row) => ({
    id: String(row._id),
    sku: row.sku,
    productId: String(row.productId),
    type: row.type,
    onHandDelta: row.onHandDelta,
    availableDelta: row.availableDelta,
    reference: row.reference,
    reason: row.reason,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
  }));
}

function toReservationView(doc: IStockReservation): ReservationView {
  return {
    id: String(doc._id),
    reference: doc.reference,
    status: doc.status,
    expiresAt: doc.expiresAt.toISOString(),
    lines: doc.lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
  };
}

// ---- Reservations -----------------------------------------------------------------

/** Releases lapsed holds. Runs lazily before reservation work; safe to call any time. */
export async function expireReservations(organizationId: string, now = new Date()): Promise<number> {
  const stale = await StockReservationModel.find({ organizationId: oid(organizationId), status: "active", expiresAt: { $lte: now } }).exec();
  let count = 0;
  for (const reservation of stale) {
    // Flip the status first so only one caller ever releases a given hold.
    const claimed = await StockReservationModel.findOneAndUpdate(
      { _id: reservation._id, status: "active" },
      { $set: { status: "expired", settledAt: now } },
    ).exec();
    if (!claimed) continue;
    const lines = claimed.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, sku: l.sku, quantity: l.quantity }));
    for (const line of lines) await applyOne(line, "release");
    await logMovements(organizationId, lines, "reservation_release", { reference: claimed.reference, actor: "system", reason: "expired" });
    count += 1;
  }
  return count;
}

export async function createReservation(organizationId: string, input: CreateReservationInput, actor = "api"): Promise<{ reservation: ReservationView; created: boolean }> {
  await expireReservations(organizationId);
  const existing = await StockReservationModel.findOne({ organizationId: oid(organizationId), reference: input.reference }).exec();
  if (existing) return { reservation: toReservationView(existing), created: false };

  const lines = await resolveLines(organizationId, input.items);
  await applyAll(organizationId, lines, "reserve");
  try {
    const doc = await StockReservationModel.create({
      organizationId: oid(organizationId),
      reference: input.reference,
      status: "active",
      lines,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    });
    await logMovements(organizationId, lines, "reservation", { reference: input.reference, actor });
    return { reservation: toReservationView(doc), created: true };
  } catch (error) {
    // A concurrent request with the same reference won: give our hold back and return theirs.
    for (const line of lines) await applyOne(line, "release");
    const winner = await StockReservationModel.findOne({ organizationId: oid(organizationId), reference: input.reference }).exec();
    if (winner) return { reservation: toReservationView(winner), created: false };
    throw error;
  }
}

async function findReservation(organizationId: string, idOrReference: string): Promise<IStockReservation> {
  const byId = Types.ObjectId.isValid(idOrReference) ? { _id: idOrReference } : null;
  const doc = await StockReservationModel.findOne({
    organizationId: oid(organizationId),
    $or: [...(byId ? [byId] : []), { reference: idOrReference }],
  }).exec();
  if (!doc) throw ActionError.notFound("Reservation not found");
  return doc;
}

export async function getReservation(organizationId: string, idOrReference: string): Promise<ReservationView> {
  await expireReservations(organizationId);
  return toReservationView(await findReservation(organizationId, idOrReference));
}

/** Paid: the held units leave the warehouse. Idempotent. */
export async function commitReservation(organizationId: string, idOrReference: string, actor = "api"): Promise<ReservationView> {
  await expireReservations(organizationId);
  const doc = await findReservation(organizationId, idOrReference);
  if (doc.status === "committed") return toReservationView(doc);
  if (doc.status !== "active") {
    throw ActionError.conflict(`This reservation is ${doc.status}; reserve the items again.`, "reservation_not_active");
  }
  const claimed = await StockReservationModel.findOneAndUpdate(
    { _id: doc._id, status: "active" },
    { $set: { status: "committed", settledAt: new Date() } },
    { returnDocument: "after" },
  ).exec();
  if (!claimed) return toReservationView(await findReservation(organizationId, String(doc._id)));
  const lines = claimed.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, sku: l.sku, quantity: l.quantity }));
  for (const line of lines) await applyOne(line, "commit");
  await logMovements(organizationId, lines, "reservation_commit", { reference: claimed.reference, actor });
  return toReservationView(claimed);
}

/** Cancelled before payment: the held units go back on sale. Idempotent. */
export async function releaseReservation(organizationId: string, idOrReference: string, actor = "api"): Promise<ReservationView> {
  const doc = await findReservation(organizationId, idOrReference);
  if (doc.status === "released" || doc.status === "expired") return toReservationView(doc);
  if (doc.status === "committed") {
    throw ActionError.conflict("This reservation was already committed (paid). Use a return to put goods back.", "reservation_committed");
  }
  const claimed = await StockReservationModel.findOneAndUpdate(
    { _id: doc._id, status: "active" },
    { $set: { status: "released", settledAt: new Date() } },
    { returnDocument: "after" },
  ).exec();
  if (!claimed) return toReservationView(await findReservation(organizationId, String(doc._id)));
  const lines = claimed.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, sku: l.sku, quantity: l.quantity }));
  for (const line of lines) await applyOne(line, "release");
  await logMovements(organizationId, lines, "reservation_release", { reference: claimed.reference, actor });
  return toReservationView(claimed);
}

// ---- Sales, returns, adjustments -----------------------------------------------------

/**
 * Sells outright (no hold). Recorded as an already-committed reservation
 * under the caller's reference, so a retried request never sells twice.
 */
export async function recordSale(organizationId: string, input: DirectSaleInput, actor = "api"): Promise<{ sale: ReservationView; created: boolean }> {
  await expireReservations(organizationId);
  const existing = await StockReservationModel.findOne({ organizationId: oid(organizationId), reference: input.reference }).exec();
  if (existing?.status === "committed") return { sale: toReservationView(existing), created: false };
  if (existing?.status === "active") {
    throw ActionError.conflict("This reference already belongs to an open reservation; commit or release it instead.", "reference_in_use");
  }

  const lines = await resolveLines(organizationId, input.items);
  await applyAll(organizationId, lines, "take");

  if (existing) {
    // The hold lapsed (or was released) but the customer paid: sell under the
    // same reference, so the order keeps one record. Claim it atomically.
    const claimed = await StockReservationModel.findOneAndUpdate(
      { _id: existing._id, status: { $in: ["expired", "released"] } },
      { $set: { status: "committed", lines, settledAt: new Date() } },
      { returnDocument: "after" },
    ).exec();
    if (!claimed) {
      for (const line of lines) await applyOne(line, "put");
      return { sale: toReservationView(await findReservation(organizationId, String(existing._id))), created: false };
    }
    await logMovements(organizationId, lines, "sale", { reference: input.reference, actor });
    return { sale: toReservationView(claimed), created: true };
  }

  try {
    const doc = await StockReservationModel.create({
      organizationId: oid(organizationId),
      reference: input.reference,
      status: "committed",
      lines,
      expiresAt: new Date(),
      settledAt: new Date(),
    });
    await logMovements(organizationId, lines, "sale", { reference: input.reference, actor });
    return { sale: toReservationView(doc), created: true };
  } catch (error) {
    for (const line of lines) await applyOne(line, "put");
    const winner = await StockReservationModel.findOne({ organizationId: oid(organizationId), reference: input.reference }).exec();
    if (winner) return { sale: toReservationView(winner), created: false };
    throw error;
  }
}

/** Goods came back (refund, exchange). Idempotent per reference + SKU. */
export async function recordReturn(organizationId: string, input: ReturnInput, actor = "api"): Promise<{ returned: number }> {
  const lines = await resolveLines(organizationId, input.items);
  let returned = 0;
  for (const line of lines) {
    const idempotencyKey = `return:${input.reference}:${line.sku.toUpperCase()}`;
    try {
      // Log first: the unique key makes a retry a no-op before stock moves.
      await logMovements(organizationId, [line], "return", { reference: input.reference, actor, idempotencyKey });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) continue;
      throw error;
    }
    await applyOne(line, "put");
    returned += line.quantity;
  }
  return { returned };
}

/** Goods in, stock count or write-off. `setOnHand` sets the physical count; `delta` changes it. */
export async function adjustStock(organizationId: string, input: StockAdjustmentInput, actor: string): Promise<StockLevel> {
  const [line] = await resolveLines(organizationId, [{ sku: input.sku, quantity: 1 }]);
  const target = line!;

  if (input.idempotencyKey) {
    const done = await StockMovementModel.exists({ organizationId: oid(organizationId), idempotencyKey: input.idempotencyKey });
    if (done) return (await getStockLevels(organizationId, [target.sku]))[0]!;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const product = await ProductModel.findById(target.productId).exec();
    const variant = product?.variants.find((v) => v.id === target.variantId);
    if (!product || !variant) throw ActionError.notFound("Variant not found");

    const onHand = variant.stock + variant.reserved;
    const nextOnHand = input.setOnHand ?? onHand + (input.delta ?? 0);
    if (nextOnHand < variant.reserved) {
      throw ActionError.conflict(
        `${variant.sku} has ${variant.reserved} unit(s) reserved; on hand can't go below that.`,
        "below_reserved",
        { reserved: variant.reserved },
      );
    }
    const delta = nextOnHand - onHand;
    if (delta === 0) return (await getStockLevels(organizationId, [target.sku]))[0]!;

    // Optimistic: only applies if nobody changed this variant since we read it.
    const result = await ProductModel.updateOne(
      { _id: product._id, variants: { $elemMatch: { id: variant.id, stock: variant.stock, reserved: variant.reserved } } },
      { $set: { "variants.$.stock": variant.stock + delta } },
    ).exec();
    if (result.modifiedCount === 1) {
      await logMovements(organizationId, [{ ...target, quantity: delta }], "adjustment", {
        reference: "",
        actor,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey ?? null,
      });
      return (await getStockLevels(organizationId, [target.sku]))[0]!;
    }
  }
  throw ActionError.conflict("Stock changed while adjusting; try again.", "concurrent_update");
}

/** Initial stock when a variant is created — logged like any other movement. */
export async function logInitialStock(organizationId: string, lines: ResolvedLine[], actor: string): Promise<void> {
  const nonZero = lines.filter((line) => line.quantity > 0);
  if (nonZero.length > 0) await logMovements(organizationId, nonZero, "initial", { reference: "", actor });
}

export type { ResolvedLine as InventoryLine };
