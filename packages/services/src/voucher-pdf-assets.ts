import { ActionError } from "@tbook/actions";
import type { VoucherPdfLayout } from "@tbook/schemas";
import { getOwnedBlob, mediaRef, ownsBlob, parseMediaRef, putBlob } from "./blob-store";
import { readStoredFile } from "./media-storage";

/**
 * Pictures an organization uploads for its ticket PDF (logo, banner,
 * background), stored in the database blob store as `/media/<hash>.png|jpg`.
 * A layout may only use pictures its own organization uploaded (checked on
 * save and again on render), so a layout can never reach another tenant's
 * files. Legacy `/uploads/ticket-assets/<org>/…` paths are still accepted
 * syntactically but only resolve if such a file exists.
 */

const MAX_BYTES = 5 * 1024 * 1024;

function assetPrefix(organizationId: string): string {
  return `/uploads/ticket-assets/${organizationId}/`;
}

/** PNG and JPEG only — the two formats the PDF renderer can embed. Sniffed from the bytes, not the file name. */
function sniffImage(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

export async function storeVoucherPdfAsset(organizationId: string, bytes: Uint8Array): Promise<{ url: string }> {
  if (bytes.length === 0) throw ActionError.validation("Choose an image to upload.");
  if (bytes.length > MAX_BYTES) throw ActionError.validation("The image is too large — keep it under 5 MB.");
  const kind = sniffImage(bytes);
  if (!kind) throw ActionError.validation("Upload a PNG or JPEG image.");
  const contentType = kind === "png" ? "image/png" : "image/jpeg";
  const hash = await putBlob({ bytes, contentType, owner: organizationId, kind: "ticket-asset" });
  return { url: mediaRef(hash, contentType) };
}

/** The stored picture behind an asset URL, only when it belongs to this organization. */
export async function readVoucherPdfAsset(organizationId: string, url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const hash = parseMediaRef(url);
  if (hash) {
    const blob = await getOwnedBlob(organizationId, hash, "ticket-asset");
    return blob ? { bytes: blob.data, contentType: blob.contentType } : null;
  }
  if (!url.startsWith(assetPrefix(organizationId)) || url.includes("..")) return null;
  const bytes = await readStoredFile(url);
  if (!bytes) return null;
  return { bytes, contentType: sniffImage(bytes) === "png" ? "image/png" : "image/jpeg" };
}

/** Syntax check only (sync): a /media reference, this org's legacy path, or https. Ownership is checked separately. */
function isAllowedImageUrl(organizationId: string, url: string): boolean {
  if (!url) return true;
  if (url.includes("..")) return false;
  return Boolean(parseMediaRef(url)) || url.startsWith(assetPrefix(organizationId)) || /^https:\/\//.test(url);
}

/** Every picture a layout points at: uploaded by this organization, or an https link. Throws on anything else. */
export async function assertLayoutImages(organizationId: string, layout: VoucherPdfLayout): Promise<void> {
  const urls = [layout.backgroundImage, ...layout.blocks.map((block) => block.src ?? "")].filter(Boolean);
  const problem = () => ActionError.validation("A picture on the ticket isn't one of your uploads. Upload it again.");
  for (const url of urls) {
    if (!isAllowedImageUrl(organizationId, url)) throw problem();
    const hash = parseMediaRef(url);
    if (hash && !(await ownsBlob(organizationId, hash, "ticket-asset"))) throw problem();
  }
}

/** Preview-safe copy: pictures that aren't allowed are dropped rather than read. */
export function withAllowedImages(organizationId: string, layout: VoucherPdfLayout): VoucherPdfLayout {
  const keep = (url: string | undefined) => (url && isAllowedImageUrl(organizationId, url) && !url.includes("..") ? url : "");
  return {
    ...layout,
    backgroundImage: keep(layout.backgroundImage),
    blocks: layout.blocks.map((block) => (block.src === undefined ? block : { ...block, src: keep(block.src) })),
  };
}
