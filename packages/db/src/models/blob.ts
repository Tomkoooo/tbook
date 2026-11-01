import mongoose, { Schema, type Model } from "mongoose";

/**
 * Content-addressed file storage in MongoDB. The id IS the SHA-256 of the
 * bytes, so identical uploads are stored once, and everything lives in the
 * database — one backup, one thing to move, no filesystem volume.
 *
 * `owners` (organization ids) and `kinds` record who uploaded it and as
 * what. They are access control, not bookkeeping: a public route only
 * serves kind "product-image", and an organization can only reference
 * blobs it owns. Unreferenced blobs are removed by a mark-and-sweep pass
 * (services/blob-store.ts), never by a counter that could drift.
 */

export const blobKinds = ["product-image", "product-image-source", "ticket-asset", "invoice"] as const;
export type BlobKind = (typeof blobKinds)[number];

export interface IBlob {
  _id: string;
  data: Buffer;
  contentType: string;
  size: number;
  owners: string[];
  kinds: BlobKind[];
  /** For a processed image: the blob of its original (kept for lossless re-cropping). */
  derivedFrom: string | null;
  createdAt: Date;
}

const BlobSchema = new Schema<IBlob>(
  {
    _id: { type: String, required: true },
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    owners: { type: [String], default: [], index: true },
    kinds: { type: [String], enum: blobKinds, default: [] },
    derivedFrom: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const BlobModel: Model<IBlob> = mongoose.models.TBookBlob ?? mongoose.model<IBlob>("TBookBlob", BlobSchema, "tbookblobs");
