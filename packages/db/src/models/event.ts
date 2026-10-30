import mongoose, { Schema, type Document, type Model, Types } from "mongoose";
import {
  attendeeFieldSchemaModes,
  eventKinds,
  eligibilityPresets,
  entityStatusSchema,
  priceBasisSchema,
  pricingRuleActionValues,
  pricingRuleAmountModes,
  pricingRuleWhenValues,
  publicListingValues,
  registrationUnits,
  ticketFeeModes,
  type Event as TBookEvent,
} from "@tbook/schemas";
import { attendeeFieldDefSchema } from "./value-object-schemas";

/** Ported from the legacy plugin's models/TBookEvent.ts. */
export interface IEvent extends Document, Omit<TBookEvent, "id" | "organizationId" | "groupId"> {
  organizationId: Types.ObjectId | null;
  groupId: Types.ObjectId | null;
}

const EligibilityFormRuleSchema = new Schema(
  {
    id: { type: String, required: true },
    fieldKey: { type: String, required: true },
    op: { type: String, required: true },
    value: { type: String, default: "" },
    message: { type: String, default: "" },
  },
  { _id: false },
);

const PricingRuleSchema = new Schema(
  {
    id: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    label: { type: String, default: "Ármódosítás" },
    when: { type: String, enum: pricingRuleWhenValues, required: true },
    action: { type: String, enum: pricingRuleActionValues, required: true },
    amount: { type: Number, default: 0 },
    amountMode: { type: String, enum: pricingRuleAmountModes, default: "fixed" },
  },
  { _id: false },
);

const EventSchema = new Schema<IEvent>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", default: null, index: true },
    groupId: { type: Schema.Types.ObjectId, ref: "TBookEventGroup", default: null, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    location: {
      address: { type: String, default: "" },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      mapEmbedUrl: { type: String, default: "" },
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
    salesOpensAt: { type: Date, default: null },
    salesClosesAt: { type: Date, default: null },
    currency: { type: String, default: "HUF" },
    ticketFeeHuf: { type: Number, required: true, min: 0 },
    ticketFeeMode: { type: String, enum: ticketFeeModes, default: "per_person" },
    registrationUnit: { type: String, enum: registrationUnits, default: "person" },
    playersPerTicket: { type: Number, default: 1, min: 1, max: 100 },
    teamMemberLimit: { type: Number, default: null, min: 1, max: 100 },
    teamMemberFieldSchema: { type: [attendeeFieldDefSchema], default: [] },
    ticketPriceBasis: { type: String, enum: priceBasisSchema.options, default: "net" },
    ticketVatPercent: { type: Number, default: 27, min: 0, max: 100 },
    kind: { type: String, enum: eventKinds, default: "standard" },
    dayPass: {
      type: new Schema(
        {
          weekdayPriceHuf: { type: Number, required: true, min: 0 },
          weekendPriceHuf: { type: Number, required: true, min: 0 },
          weekendDays: { type: [Number], default: [6, 0] },
          dailyCapacity: { type: Number, default: null, min: 0 },
          capacityOverrides: { type: Schema.Types.Mixed, default: {} },
          closedDays: { type: [String], default: [] },
        },
        { _id: false, minimize: false },
      ),
      default: null,
    },
    // Plain object (not a Map) so a single findOneAndUpdate can $inc several
    // `daySold.<date>` paths atomically — that is what makes reserving a
    // multi-day basket all-or-nothing without a transaction.
    daySold: { type: Schema.Types.Mixed, default: {} },
    capacity: { type: Number, default: null },
    soldGuestCount: { type: Number, default: 0, min: 0 },
    heroImage: { type: String, default: "" },
    voucherHeaderImage: { type: String, default: "" },
    vouchersEnabled: { type: Boolean, default: true },
    attendeeFieldSchema: { type: [attendeeFieldDefSchema], default: [] },
    attendeeFieldSchemaMode: { type: String, enum: attendeeFieldSchemaModes, default: "extend" },
    // Modern presets plus legacy darts-specific values still stored on older events
    // (under18/under18_female/women) — accepted here, expanded to the modern shape
    // at read time by @tbook/domain, not migrated in the DB.
    eligibilityPreset: { type: String, enum: eligibilityPresets, default: "none" },
    eligibilityMinAge: { type: Number, default: null, min: 0, max: 120 },
    eligibilityMaxAge: { type: Number, default: null, min: 0, max: 120 },
    eligibilityAllowedGenders: { type: [String], default: [] },
    eligibilityBirthDateFieldKey: { type: String, default: null },
    eligibilityGenderFieldKey: { type: String, default: null },
    eligibilityFormRules: {
      type: new Schema(
        {
          logic: { type: String, enum: ["and", "or"], default: "and" },
          rules: { type: [EligibilityFormRuleSchema], default: [] },
        },
        { _id: false },
      ),
      default: null,
    },
    pricingRules: { type: [PricingRuleSchema], default: [] },
    publicListing: { type: String, enum: publicListingValues, default: "listed" },
    tdarts: {
      type: new Schema(
        { enabled: { type: Boolean, default: false }, tournamentCode: { type: String, default: null } },
        { _id: false },
      ),
      default: () => ({ enabled: false, tournamentCode: null }),
    },
    publicEntryList: { type: Boolean, default: false },
    status: { type: String, enum: entityStatusSchema.options, default: "draft", index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false },
);

/** Nights between the event start/end dates (min 1). */
export function eventNights(event: Pick<IEvent, "startDate" | "endDate">): number {
  const ms = new Date(event.endDate).getTime() - new Date(event.startDate).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

export const EventModel: Model<IEvent> =
  mongoose.models.TBookEvent ?? mongoose.model<IEvent>("TBookEvent", EventSchema, "tbookevents");
