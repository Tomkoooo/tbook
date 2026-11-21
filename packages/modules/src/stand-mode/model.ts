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
  /** Belső fogyasztás from the stand's stock (reduces it). */
  internal: number;
  /** Belső fogyasztás outside the stand: counted as internal use, not taken from the stand's stock. */
  internalOutside: number;
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
  /** A practice day: never in stats, history or the next day's opening. One per event, under date SANDBOX_DATE. */
  sandbox: boolean;
  /** Recorded after the fact: closing counts and money only. */
  manual: { cashHuf: number; cardHuf: number } | null;
  /** Cash counted at closing (fixes the cash/card split; revenue is the sales total either way). */
  cashActualHuf: number | null;
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
    internalOutside: { type: Number, default: 0 },
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
    sandbox: { type: Boolean, default: false },
    cashActualHuf: { type: Number, default: null },
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

export type StandCounter = "restocked" | "soldCash" | "soldCard" | "internal" | "internalOutside";

/**
 * One thing that was done on a day: a sale, internal use, a restock, an
 * opening fix — or its reversal (storno). Written next to every counter
 * change, so a day's story can be read back and any entry reversed.
 * Days opened before the log existed simply have fewer entries than their
 * counters say; those can still be reversed per product.
 */
export interface IStandEntry extends Document {
  organizationId: Types.ObjectId;
  eventId: Types.ObjectId;
  dayId: Types.ObjectId;
  productId: Types.ObjectId;
  productName: string;
  field: StandCounter | "opening";
  /** Signed: negative = a storno / undo. For "opening" the new count. */
  quantity: number;
  /** "opening" only: the count before. */
  previous: number | null;
  priceHuf: number;
  depositHuf: number;
  storno: boolean;
  /** The entry this one reverses (a storno made from the log). */
  reverses: Types.ObjectId | null;
  /** Set on an entry once it has been reversed; an entry can be reversed once. */
  stornoed: boolean;
  by: string;
  at: Date;
}

const StandEntrySchema = new Schema<IStandEntry>({
  organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
  eventId: { type: Schema.Types.ObjectId, required: true },
  dayId: { type: Schema.Types.ObjectId, required: true, index: true },
  productId: { type: Schema.Types.ObjectId, required: true },
  productName: { type: String, default: "" },
  field: { type: String, enum: ["restocked", "soldCash", "soldCard", "internal", "internalOutside", "opening"], required: true },
  quantity: { type: Number, required: true },
  previous: { type: Number, default: null },
  priceHuf: { type: Number, default: 0 },
  depositHuf: { type: Number, default: 0 },
  storno: { type: Boolean, default: false },
  reverses: { type: Schema.Types.ObjectId, default: null },
  stornoed: { type: Boolean, default: false },
  by: { type: String, default: "" },
  at: { type: Date, default: () => new Date() },
});

export const StandEntryModel: Model<IStandEntry> = mongoose.models.TBookStandEntry ?? mongoose.model<IStandEntry>("TBookStandEntry", StandEntrySchema, "tbookstandentries");
