import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

export interface IStandProduct extends Document {
  organizationId: Types.ObjectId;
  eventId: Types.ObjectId;
  name: string;
  category: "drink" | "food";
  /** Shelf price, gross HUF; includes depositHuf. */
  priceHuf: number;
  /** Visszaváltási érték (can/bottle deposit) inside the price. Not profit. */
  depositHuf: number;
  /** Purchase price per unit without deposit; null = unknown. */
  costHuf: number | null;
  /** Uploaded image path or http(s) link. */
  image: string;
  /** Extra restock amounts for this product, besides the event defaults. */
  quickAdds: number[];
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const StandProductSchema = new Schema<IStandProduct>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true, index: true },
    name: { type: String, required: true },
    category: { type: String, enum: ["drink", "food"], default: "drink" },
    priceHuf: { type: Number, required: true, min: 0 },
    depositHuf: { type: Number, default: 0, min: 0 },
    costHuf: { type: Number, default: null, min: 0 },
    image: { type: String, default: "" },
    quickAdds: { type: [Number], default: [] },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const StandProductModel: Model<IStandProduct> =
  mongoose.models.TBookStandProduct ?? mongoose.model<IStandProduct>("TBookStandProduct", StandProductSchema, "tbookstandproducts");

export interface IStandLine {
  productId: Types.ObjectId;
  /** Snapshots, so a later price change doesn't rewrite history. */
  name: string;
  category: "drink" | "food";
  priceHuf: number;
  depositHuf: number;
  costHuf: number | null;
  image: string;
  opening: number;
  restocked: number;
  soldCash: number;
  soldCard: number;
  internal: number;
  counted: number | null;
}

export interface IStandDay extends Document {
  organizationId: Types.ObjectId;
  eventId: Types.ObjectId;
  /** yyyy-mm-dd; one per event. */
  date: string;
  status: "open" | "closed";
  /** Sales also drive the printer and card reader (set when opening). */
  devices: boolean;
  /** Recorded after the fact: closing counts and money only. */
  manual: { cashHuf: number; cardHuf: number } | null;
  lines: IStandLine[];
  note: string;
  openedAt: Date;
  closedAt: Date | null;
  reportSentTo: string;
  createdAt: Date;
  updatedAt: Date;
}

const StandLineSchema = new Schema<IStandLine>(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    name: String,
    category: { type: String, enum: ["drink", "food"], default: "drink" },
    priceHuf: { type: Number, default: 0 },
    depositHuf: { type: Number, default: 0 },
    costHuf: { type: Number, default: null },
    image: { type: String, default: "" },
    opening: { type: Number, default: 0 },
    restocked: { type: Number, default: 0 },
    soldCash: { type: Number, default: 0 },
    soldCard: { type: Number, default: 0 },
    internal: { type: Number, default: 0 },
    counted: { type: Number, default: null },
  },
  { _id: false },
);

const StandDaySchema = new Schema<IStandDay>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true },
    date: { type: String, required: true },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    devices: { type: Boolean, default: false },
    manual: { type: new Schema({ cashHuf: Number, cardHuf: Number }, { _id: false }), default: null },
    lines: { type: [StandLineSchema], default: [] },
    note: { type: String, default: "" },
    openedAt: { type: Date, default: () => new Date() },
    closedAt: { type: Date, default: null },
    reportSentTo: { type: String, default: "" },
  },
  { timestamps: true },
);
StandDaySchema.index({ eventId: 1, date: 1 }, { unique: true });

export const StandDayModel: Model<IStandDay> = mongoose.models.TBookStandDay ?? mongoose.model<IStandDay>("TBookStandDay", StandDaySchema, "tbookstanddays");
