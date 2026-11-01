import { createHash } from "node:crypto";
import { BlobModel, BookingModel, EventGroupModel, EventModel, OrganizationModel, ProductModel, type BlobKind } from "@tbook/db";

/**
 * Content-addressed blobs in MongoDB (see db/models/blob.ts).
 *
 * References look like `/media/<sha256>.<ext>` wherever a URL is stored.
 * Cleanup is mark-and-sweep: collect every hash any record points at, and
 * delete blobs nobody points at once they are older than a grace period
 * (so an image uploaded into an unsaved form survives). It runs on its own,
 * in the background, at most every few hours per process.
 */

/** MongoDB's document limit is 16 MB; leave headroom for the other fields. */
export const MAX_BLOB_BYTES = 15 * 1024 * 1024;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const SWEEP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const MEDIA_REF = /^\/media\/([a-f0-9]{64})\.(webp|png|jpg|pdf)$/;

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function mediaRef(hash: string, contentType: string): string {
  return `/media/${hash}.${EXTENSIONS[contentType] ?? "bin"}`;
}

/** The blob hash inside a `/media/<hash>.<ext>` reference, or null. */
export function parseMediaRef(ref: string | null | undefined): string | null {
  return ref ? (MEDIA_REF.exec(ref.trim())?.[1] ?? null) : null;
}

/**
 * Stores bytes (once — identical content is deduplicated) and records the
 * owner and kind. Returns the hash.
 */
export async function putBlob(input: {
  bytes: Uint8Array;
  contentType: string;
  owner: string;
  kind: BlobKind;
  derivedFrom?: string | null;
}): Promise<string> {
  if (input.bytes.length > MAX_BLOB_BYTES) throw new Error("File too large to store.");
  const hash = hashBytes(input.bytes);
  await BlobModel.updateOne(
    { _id: hash },
    {
      $setOnInsert: {
        data: Buffer.from(input.bytes),
        contentType: input.contentType,
        size: input.bytes.length,
        derivedFrom: input.derivedFrom ?? null,
      },
      $addToSet: { owners: input.owner, kinds: input.kind },
    },
    { upsert: true },
  )
    .exec()
    .catch((error: { code?: number }) => {
      // Two identical uploads at once: the other one inserted it — just add our owner/kind.
      if (error.code !== 11000) throw error;
      return BlobModel.updateOne({ _id: hash }, { $addToSet: { owners: input.owner, kinds: input.kind } }).exec();
    });
  scheduleSweep();
  return hash;
}

export async function getBlob(hash: string): Promise<{ data: Buffer; contentType: string; owners: string[]; kinds: BlobKind[]; derivedFrom: string | null } | null> {
  const blob = await BlobModel.findById(hash).lean().exec();
  if (!blob) return null;
  return {
    data: Buffer.from(blob.data.buffer ?? blob.data),
    contentType: blob.contentType,
    owners: blob.owners,
    kinds: blob.kinds,
    derivedFrom: blob.derivedFrom ?? null,
  };
}

/** A blob, only if this organization owns it as this kind. */
export async function getOwnedBlob(organizationId: string, hash: string, kind: BlobKind) {
  const blob = await getBlob(hash);
  return blob && blob.owners.includes(organizationId) && blob.kinds.includes(kind) ? blob : null;
}

export async function ownsBlob(organizationId: string, hash: string, kind: BlobKind): Promise<boolean> {
  return Boolean(await BlobModel.exists({ _id: hash, owners: organizationId, kinds: kind }).exec());
}

// ---- Mark and sweep --------------------------------------------------------------

/** Every blob hash any record points at — including the originals of referenced images. */
export async function collectReferencedBlobs(): Promise<Set<string>> {
  const refs = new Set<string>();
  const add = (value: string | null | undefined) => {
    const hash = parseMediaRef(value) ?? (value && /^[a-f0-9]{64}$/.test(value) ? value : null);
    if (hash) refs.add(hash);
  };

  for await (const product of ProductModel.find({}, { images: 1 }).lean().cursor()) product.images?.forEach(add);
  for await (const org of OrganizationModel.find({}, { "settings.voucherPdfLayout": 1 }).lean().cursor()) {
    const layout = org.settings?.voucherPdfLayout as { backgroundImage?: string; blocks?: Array<{ src?: string }> } | null | undefined;
    add(layout?.backgroundImage);
    layout?.blocks?.forEach((block) => add(block.src));
  }
  for await (const event of EventModel.find({ voucherHeaderImage: { $ne: "" } }, { voucherHeaderImage: 1 }).lean().cursor()) add(event.voucherHeaderImage);
  for await (const group of EventGroupModel.find({ voucherHeaderImage: { $ne: "" } }, { voucherHeaderImage: 1 }).lean().cursor()) add(group.voucherHeaderImage);
  for await (const booking of BookingModel.find({ invoicePdfBlobId: { $ne: null } }, { invoicePdfBlobId: 1 }).lean().cursor()) {
    add((booking as { invoicePdfBlobId?: string | null }).invoicePdfBlobId);
  }

  // Keep the originals of every kept processed image.
  const derived = await BlobModel.find({ _id: { $in: [...refs] }, derivedFrom: { $ne: null } }, { derivedFrom: 1 }).lean().exec();
  derived.forEach((blob) => blob.derivedFrom && refs.add(blob.derivedFrom));
  return refs;
}

/** Deletes blobs nothing refers to that are older than the grace period. Returns how many. */
export async function sweepUnreferencedBlobs(now = new Date(), graceMs = SWEEP_GRACE_MS): Promise<number> {
  const referenced = await collectReferencedBlobs();
  const result = await BlobModel.deleteMany({ _id: { $nin: [...referenced] }, createdAt: { $lt: new Date(now.getTime() - graceMs) } }).exec();
  return result.deletedCount;
}

let lastSweep = 0;
function scheduleSweep(): void {
  if (process.env.NODE_ENV === "test" || Date.now() - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = Date.now();
  setTimeout(() => {
    sweepUnreferencedBlobs().catch((error) => console.error("[blob sweep]", error));
  }, 30_000).unref?.();
}
