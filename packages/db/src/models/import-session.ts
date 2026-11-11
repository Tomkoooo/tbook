import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

/**
 * An uploaded spreadsheet, parsed, waiting for the admin to map its columns
 * to an import target. Never a file on disk: the parsed cells are kept here
 * and MongoDB's TTL index removes the session a day later.
 */
export interface ImportSessionSheet {
  name: string;
  header: string[];
  rows: string[][];
}

export interface IImportSession extends Document {
  organizationId: Types.ObjectId;
  createdByUserId: string | null;
  fileName: string;
  sheets: ImportSessionSheet[];
  expiresAt: Date;
  createdAt: Date;
}

const ImportSessionSchema = new Schema<IImportSession>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
    createdByUserId: { type: String, default: null },
    fileName: { type: String, default: "" },
    sheets: { type: Schema.Types.Mixed, default: [] },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

ImportSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ImportSessionModel: Model<IImportSession> =
  mongoose.models.TBookImportSession ??
  mongoose.model<IImportSession>("TBookImportSession", ImportSessionSchema, "tbookimportsessions");
