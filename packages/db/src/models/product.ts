import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import {
  productStatuses,
  reservationStatuses,
  salesChannels,
  stockMovementTypes,
  type ProductStatus,
  type ReservationStatus,
  type SalesChannel,
  type StockMovementType,
} from "@tbook/schemas";

/**
 * Products and stock. Variants are embedded so a stock change is one
 * atomic `$inc` on `variants.$` guarded by `stock >= qty` — the same
 * no-oversell pattern as event capacity and day-pass days.
 */

export interface IProductVariant {
  id: string;
  sku: string;
  options: Record<string, string>;
  priceGross: number | null;
  stock: number;
  reserved: number;
  active: boolean;
}

export interface IProduct extends Document {
  organizationId: Types.ObjectId;
  name: string;
  description: string;
  images: string[];
  category: string;
  status: ProductStatus;
  channels: SalesChannel[];
  currency: string;
  priceGross: number;
  vatPercent: number;
  variantOptions: Array<{ name: string; values: string[] }>;
  variants: IProductVariant[];
  createdAt: Date;
  updatedAt: Date;
}

const VariantSchema = new Schema<IProductVariant>(
  {
    id: { type: String, required: true },
    sku: { type: String, required: true },
    options: { type: Schema.Types.Mixed, default: {} },
    priceGross: { type: Number, default: null },
    stock: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const ProductSchema = new Schema<IProduct>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    images: { type: [String], default: [] },
    category: { type: String, default: "" },
    status: { type: String, enum: productStatuses, default: "draft", index: true },
    channels: { type: [String], enum: salesChannels, default: ["pos", "webshop"] },
    currency: { type: String, default: "HUF" },
    priceGross: { type: Number, required: true, min: 0 },
    vatPercent: { type: Number, default: 27 },
    variantOptions: { type: [{ _id: false, name: String, values: [String] }], default: [] },
    variants: { type: [VariantSchema], default: [] },
  },
  { timestamps: true },
);

// SKU lookups (the API addresses stock by SKU). Uniqueness per org is enforced in the service.
ProductSchema.index({ organizationId: 1, "variants.sku": 1 });

export const ProductModel: Model<IProduct> =
  mongoose.models.TBookProduct ?? mongoose.model<IProduct>("TBookProduct", ProductSchema, "tbookproducts");

// ---- Movement log -------------------------------------------------------------

export interface IStockMovement extends Document {
  organizationId: Types.ObjectId;
  productId: Types.ObjectId;
  variantId: string;
  sku: string;
  type: StockMovementType;
  /** Change to on-hand units (sale −, goods in +). Reservations change availability only, so 0 here. */
  onHandDelta: number;
  /** Change to available units. */
  availableDelta: number;
  /** What caused it: a reservation/sale reference, merch sale id, or admin note. */
  reference: string;
  reason: string;
  /** Who: "api" (webshop), "pos", or a user id. */
  actor: string;
  idempotencyKey: string | null;
  createdAt: Date;
}

const StockMovementSchema = new Schema<IStockMovement>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
    productId: { type: Schema.Types.ObjectId, required: true, index: true },
    variantId: { type: String, required: true },
    sku: { type: String, required: true },
    type: { type: String, enum: stockMovementTypes, required: true },
    onHandDelta: { type: Number, required: true },
    availableDelta: { type: Number, required: true },
    reference: { type: String, default: "" },
    reason: { type: String, default: "" },
    actor: { type: String, default: "" },
    idempotencyKey: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
StockMovementSchema.index({ organizationId: 1, createdAt: -1 });
StockMovementSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });

export const StockMovementModel: Model<IStockMovement> =
  mongoose.models.TBookStockMovement ??
  mongoose.model<IStockMovement>("TBookStockMovement", StockMovementSchema, "tbookstockmovements");

// ---- Reservations ---------------------------------------------------------------

export interface IStockReservationLine {
  productId: Types.ObjectId;
  variantId: string;
  sku: string;
  quantity: number;
}

export interface IStockReservation extends Document {
  organizationId: Types.ObjectId;
  reference: string;
  status: ReservationStatus;
  lines: IStockReservationLine[];
  expiresAt: Date;
  settledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const StockReservationSchema = new Schema<IStockReservation>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
    reference: { type: String, required: true },
    status: { type: String, enum: reservationStatuses, default: "active", index: true },
    lines: {
      type: [{ _id: false, productId: Schema.Types.ObjectId, variantId: String, sku: String, quantity: Number }],
      default: [],
    },
    expiresAt: { type: Date, required: true, index: true },
    settledAt: { type: Date, default: null },
  },
  { timestamps: true },
);
// One reservation per caller reference: a retried request gets the same hold back.
StockReservationSchema.index({ organizationId: 1, reference: 1 }, { unique: true });

export const StockReservationModel: Model<IStockReservation> =
  mongoose.models.TBookStockReservation ??
  mongoose.model<IStockReservation>("TBookStockReservation", StockReservationSchema, "tbookstockreservations");

// ---- On-site merch sales ------------------------------------------------------------

export interface IMerchSaleLine {
  productId: Types.ObjectId;
  variantId: string;
  sku: string;
  name: string;
  /** "M · Black" — option values joined, empty for a single-variant product. */
  variantLabel: string;
  quantity: number;
  unitPriceGross: number;
  vatPercent: number;
}

export interface IMerchSale extends Document {
  organizationId: Types.ObjectId;
  lines: IMerchSaleLine[];
  totalGross: number;
  currency: string;
  paymentMethod: "cash" | "card";
  /** Card terminal slip number (e.g. myPOS), optional. */
  paymentReference: string;
  receipt: { status: "none" | "pending" | "issued" | "failed"; number: string | null; pdfFileName: string | null; error: string | null; issuedAt: Date | null };
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const MerchSaleSchema = new Schema<IMerchSale>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
    lines: {
      type: [
        {
          _id: false,
          productId: Schema.Types.ObjectId,
          variantId: String,
          sku: String,
          name: String,
          variantLabel: String,
          quantity: Number,
          unitPriceGross: Number,
          vatPercent: Number,
        },
      ],
      default: [],
    },
    totalGross: { type: Number, required: true },
    currency: { type: String, default: "HUF" },
    paymentMethod: { type: String, enum: ["cash", "card"], required: true },
    paymentReference: { type: String, default: "" },
    receipt: {
      status: { type: String, enum: ["none", "pending", "issued", "failed"], default: "none" },
      number: { type: String, default: null },
      pdfFileName: { type: String, default: null },
      error: { type: String, default: null },
      issuedAt: { type: Date, default: null },
    },
    createdByUserId: { type: String, default: null },
  },
  { timestamps: true },
);
MerchSaleSchema.index({ organizationId: 1, createdAt: -1 });

export const MerchSaleModel: Model<IMerchSale> =
  mongoose.models.TBookMerchSale ?? mongoose.model<IMerchSale>("TBookMerchSale", MerchSaleSchema, "tbookmerchsales");
