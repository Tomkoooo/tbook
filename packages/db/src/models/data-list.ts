import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import { dataListKeyNormalizations, type DataList, type DataListRow } from "@tbook/schemas";

export interface IDataList extends Document, Omit<DataList, "id" | "organizationId"> {
  organizationId: Types.ObjectId;
}

export interface IDataListRow extends Document, Omit<DataListRow, "id" | "organizationId" | "listId"> {
  organizationId: Types.ObjectId;
  listId: Types.ObjectId;
}

const DataListSchema = new Schema<IDataList>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    keyColumn: { type: String, required: true },
    keyNormalization: { type: String, enum: dataListKeyNormalizations, default: "trim_case" },
    emailColumn: { type: String, default: null },
    nameColumn: { type: String, default: null },
    columns: {
      type: [new Schema({ key: { type: String, required: true }, label: { type: String, required: true } }, { _id: false })],
      default: [],
    },
    rowCount: { type: Number, default: 0 },
    sourceFileName: { type: String, default: "" },
  },
  { timestamps: true },
);

/** Rows live in their own collection: a list can hold tens of thousands of them. */
const DataListRowSchema = new Schema<IDataListRow>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true },
    listId: { type: Schema.Types.ObjectId, ref: "TBookDataList", required: true },
    key: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: false, minimize: false },
);

DataListRowSchema.index({ listId: 1, key: 1 }, { unique: true });

export const DataListModel: Model<IDataList> =
  mongoose.models.TBookDataList ?? mongoose.model<IDataList>("TBookDataList", DataListSchema, "tbookdatalists");

export const DataListRowModel: Model<IDataListRow> =
  mongoose.models.TBookDataListRow ?? mongoose.model<IDataListRow>("TBookDataListRow", DataListRowSchema, "tbookdatalistrows");
