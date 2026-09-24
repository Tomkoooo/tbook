import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import { accommodationModes, baseRateModes, entityStatusSchema, priceBasisSchema, type Hotel } from "@tbook/schemas";
import { attendeeFieldDefSchema, optionDefSchema } from "./value-object-schemas";

/** Ported from the legacy plugin's models/TBookHotel.ts. */
export interface IHotel extends Document, Omit<Hotel, "id" | "organizationId" | "groupId" | "eventId"> {
  organizationId: Types.ObjectId | null;
  /** Hotels are owned by the event group (shared across events). */
  groupId: Types.ObjectId | null;
  /** @deprecated Legacy per-event hotels — migrated to groupId on read. */
  eventId: Types.ObjectId | null;
}

const PackageDealSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    nights: { type: Number, required: true, min: 1 },
    priceHuf: { type: Number, required: true, min: 0 },
    maxGuests: { type: Number, default: null, min: 1, max: 50 },
    inventoryUnits: { type: Number, default: null, min: 0, max: 10_000 },
    roomTypeKey: { type: String, default: null },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const ExtrasSectionSchema = new Schema(
  {
    label: { type: String, required: true },
    description: { type: String, default: "" },
    options: { type: [optionDefSchema], default: [] },
  },
  { _id: false },
);

const RoomTypeSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    baseRateHuf: { type: Number, required: true, min: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

/** @deprecated Migrated to extrasSection on read — kept for legacy reads. */
const AddonGroupSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
    options: { type: [optionDefSchema], default: [] },
  },
  { _id: false },
);

const HotelSchema = new Schema<IHotel>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", default: null, index: true },
    groupId: { type: Schema.Types.ObjectId, ref: "TBookEventGroup", default: null, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", default: null, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    address: { type: String, default: "" },
    distanceFromVenueKm: { type: Number, default: null, min: 0 },
    contactEmail: { type: String, default: "" },
    contactPhone: { type: String, default: "" },
    gallery: { type: [String], default: [] },
    currency: { type: String, default: "HUF" },
    bookingCapacity: { type: Number, default: null, min: 0 },
    roomInventory: { type: Number, default: null, min: 0 },
    registrationFieldSchema: { type: [attendeeFieldDefSchema], default: [] },
    pricing: {
      priceBasis: { type: String, enum: priceBasisSchema.options, default: "net" },
      vatPercent: { type: Number, default: 27, min: 0, max: 100 },
      accommodationMode: { type: String, enum: accommodationModes, default: undefined },
      roomTypes: { type: [RoomTypeSchema], default: [] },
      packages: { type: [PackageDealSchema], default: [] },
      extrasSection: { type: ExtrasSectionSchema, default: null },
      addonGroups: { type: [AddonGroupSchema], default: [] },
      baseRateHuf: { type: Number, min: 0 },
      baseRateMode: { type: String, enum: baseRateModes },
      options: { type: [optionDefSchema], default: undefined },
    },
    status: { type: String, enum: entityStatusSchema.options, default: "draft", index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const HotelModel: Model<IHotel> =
  mongoose.models.TBookHotel ?? mongoose.model<IHotel>("TBookHotel", HotelSchema, "tbookhotels");
