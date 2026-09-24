import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import { priceBasisSchema, entityStatusSchema, type EventGroup } from "@tbook/schemas";
import { attendeeFieldDefSchema, optionDefSchema } from "./value-object-schemas";

/** Ported from the legacy plugin's models/TBookEventGroup.ts. */
export interface IEventGroup extends Document, Omit<EventGroup, "id" | "organizationId"> {
  organizationId: Types.ObjectId | null;
}

const EventGroupSchema = new Schema<IEventGroup>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", default: null, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    status: { type: String, enum: entityStatusSchema.options, default: "draft", index: true },
    defaultBookingOptions: { type: [optionDefSchema], default: [] },
    defaultAttendeeFieldSchema: { type: [attendeeFieldDefSchema], default: [] },
    defaultPriceBasis: { type: String, enum: priceBasisSchema.options, default: "net" },
    defaultVatPercent: { type: Number, default: 27, min: 0, max: 100 },
    listOnTBookSite: { type: Boolean, default: false },
    listingTitle: { type: String, default: "" },
    listingUrl: { type: String, default: "" },
    listingImage: { type: String, default: "" },
    defaultHeroImage: { type: String, default: "" },
    voucherHeaderImage: { type: String, default: "" },
    apiKeyHash: { type: String, required: true, index: true },
    apiKeyHint: { type: String, required: true },
    apiKeyCreatedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export const EventGroupModel: Model<IEventGroup> =
  mongoose.models.TBookEventGroup ??
  mongoose.model<IEventGroup>("TBookEventGroup", EventGroupSchema, "tbookeventgroups");
