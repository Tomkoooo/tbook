import { Schema } from "mongoose";
import { attendeeFieldTypes, optionPriceModes, optionTypes } from "@tbook/schemas";

/**
 * Mongoose sub-schemas for the shared value objects in
 * @tbook/schemas/value-objects.ts. Defined once here (unlike the legacy
 * plugin, which copy-pasted near-identical versions into three separate
 * model files) and reused by every model that embeds them. Enum arrays are
 * imported from @tbook/schemas so the allowed values can't drift between
 * the Zod validation layer and the Mongoose persistence layer.
 */

export const optionChoiceSchema = new Schema(
  {
    value: { type: String, required: true },
    label: { type: String, required: true },
    priceHuf: { type: Number, default: 0 },
    priceMode: { type: String, enum: optionPriceModes, default: "fixed" },
  },
  { _id: false },
);

export const optionDefSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: optionTypes, required: true },
    required: { type: Boolean, default: false },
    defaultValue: { type: Schema.Types.Mixed, default: null },
    choices: { type: [optionChoiceSchema], default: undefined },
    unitPriceHuf: { type: Number },
    priceMode: { type: String, enum: optionPriceModes },
    min: { type: Number },
    max: { type: Number },
    dependsOn: {
      type: new Schema({ key: { type: String, required: true }, values: { type: [String], default: [] } }, { _id: false }),
      default: null,
    },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

export const attendeeFieldChoiceSchema = new Schema(
  {
    value: { type: String, required: true },
    label: { type: String, required: true },
  },
  { _id: false },
);

export const attendeeFieldDefSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: attendeeFieldTypes, required: true },
    required: { type: Boolean, default: false },
    helpText: { type: String, default: "" },
    choices: { type: [attendeeFieldChoiceSchema], default: undefined },
    min: { type: Number },
    max: { type: Number },
    sortOrder: { type: Number, default: 0 },
    showWhen: {
      type: new Schema({ fieldKey: { type: String, required: true }, values: { type: [String], default: [] } }, { _id: false }),
      default: undefined,
    },
    unique: { type: Boolean },
    identifier: { type: Boolean },
    choicesSource: { type: String },
  },
  { _id: false },
);

export const bookingTeamMemberSchema = new Schema(
  {
    fields: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

export const bookingAttendeeSchema = new Schema(
  {
    id: { type: String },
    registrationNumber: { type: String },
    fields: { type: Schema.Types.Mixed, default: {} },
    members: { type: [bookingTeamMemberSchema], default: undefined },
    tags: { type: [String], default: undefined },
  },
  { _id: false },
);
