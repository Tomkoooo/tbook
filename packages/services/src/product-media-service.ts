import { ActionError } from "@tbook/actions";
import { getBlob, getOwnedBlob, mediaRef, ownsBlob, parseMediaRef, putBlob } from "./blob-store";

/**
 * Product images, stored in the database blob store (blob-store.ts).
 *
 * An upload becomes two blobs: a "source" (the original, EXIF-rotated and
 * capped at 4000 px, kept for lossless re-cropping) and the processed
 * image — cropped, at most 2000 px, WebP, metadata stripped — which is
 * what products reference as `/media/<sha256>.webp`. Identical uploads are
 * stored once. Only processed images are served publicly.
 */

export const PRODUCT_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 2000;
const SOURCE_EDGE = 4000;
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "heif", "tiff"]);

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function loadSharp() {
  // Imported lazily: native module, only needed when an image is processed.
  return (await import("sharp")).default;
}

/** Crops (in the given image's own pixel space), caps at 2000 px, WebP. */
async function render(image: Buffer, crop: CropRect | null): Promise<Buffer> {
  const sharp = await loadSharp();
  const oriented = await sharp(image, { limitInputPixels: 80_000_000 }).rotate().toBuffer({ resolveWithObject: true });
  let pipeline = sharp(oriented.data);
  if (crop) {
    const { width = 0, height = 0 } = oriented.info;
    const left = Math.max(0, Math.min(Math.round(crop.x), width - 1));
    const top = Math.max(0, Math.min(Math.round(crop.y), height - 1));
    const w = Math.max(1, Math.min(Math.round(crop.width), width - left));
    const h = Math.max(1, Math.min(Math.round(crop.height), height - top));
    pipeline = pipeline.extract({ left, top, width: w, height: h });
  }
  return pipeline.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
}

/** The original, normalised: EXIF orientation applied, ≤4000 px, high-quality WebP, metadata stripped. */
async function normaliseSource(upload: Buffer): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp(upload, { limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: SOURCE_EDGE, height: SOURCE_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 92 })
    .toBuffer();
}

/**
 * Stores an upload and returns the reference products use (`/media/<hash>.webp`).
 * `crop` is in the uploaded picture's pixels, as the admin saw it.
 */
export async function storeProductImage(organizationId: string, upload: Buffer, crop: CropRect | null): Promise<string> {
  if (upload.length === 0) throw ActionError.validation("The file is empty.");
  if (upload.length > PRODUCT_IMAGE_MAX_BYTES) throw ActionError.validation("Images can be at most 15 MB.");

  const sharp = await loadSharp();
  let format: string | undefined;
  try {
    format = (await sharp(upload).metadata()).format;
  } catch {
    throw ActionError.validation("That file isn't an image we can read (use JPG, PNG, WebP or HEIC).");
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) throw ActionError.validation("Use a JPG, PNG, WebP or HEIC image.");

  const source = await normaliseSource(upload);
  const sourceHash = await putBlob({ bytes: source, contentType: "image/webp", owner: organizationId, kind: "product-image-source" });
  // Crop coordinates refer to the upload; the normalised source has the same
  // orientation but may be scaled down, so scale the rectangle with it.
  const scaledCrop = crop ? await scaleCrop(upload, source, crop) : null;
  const processed = await render(source, scaledCrop);
  const hash = await putBlob({ bytes: processed, contentType: "image/webp", owner: organizationId, kind: "product-image", derivedFrom: sourceHash });
  return mediaRef(hash, "image/webp");
}

async function scaleCrop(upload: Buffer, source: Buffer, crop: CropRect): Promise<CropRect> {
  const sharp = await loadSharp();
  const oriented = await sharp(upload).rotate().toBuffer({ resolveWithObject: true });
  const target = await sharp(source).metadata();
  const factor = (target.width ?? oriented.info.width) / oriented.info.width;
  return { x: crop.x * factor, y: crop.y * factor, width: crop.width * factor, height: crop.height * factor };
}

async function sourceOf(organizationId: string, ref: string): Promise<{ hash: string; data: Buffer }> {
  const hash = parseMediaRef(ref);
  const image = hash ? await getOwnedBlob(organizationId, hash, "product-image") : null;
  if (!image) throw ActionError.validation("Only images uploaded here can be cropped.");
  const source = image.derivedFrom ? await getOwnedBlob(organizationId, image.derivedFrom, "product-image-source") : null;
  if (!source) throw ActionError.notFound("The original of this image is missing; upload it again.");
  return { hash: image.derivedFrom!, data: source.data };
}

/** Re-crops from the stored original (crop in the original's pixels). Returns the new reference. */
export async function recropProductImage(organizationId: string, ref: string, crop: CropRect): Promise<string> {
  const source = await sourceOf(organizationId, ref);
  const processed = await render(source.data, crop);
  const hash = await putBlob({ bytes: processed, contentType: "image/webp", owner: organizationId, kind: "product-image", derivedFrom: source.hash });
  return mediaRef(hash, "image/webp");
}

/** The original (WebP), for the cropper. */
export async function readProductImageOriginal(organizationId: string, ref: string): Promise<Buffer | null> {
  try {
    return (await sourceOf(organizationId, ref)).data;
  } catch {
    return null;
  }
}

/** Serves `/media/<hash>.webp` — processed product images only; nothing else in the store is public. */
export async function readPublicProductImage(hash: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const blob = await getBlob(hash);
  return blob?.kinds.includes("product-image") ? blob.data : null;
}

/** True when the reference is a processed image this organization uploaded. */
export async function isOwnProductImage(organizationId: string, ref: string): Promise<boolean> {
  const hash = parseMediaRef(ref);
  return hash ? ownsBlob(organizationId, hash, "product-image") : false;
}
