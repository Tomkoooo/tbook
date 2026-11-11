import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

/** One bus (route) to an event: where and when it leaves, how many seats, who the captain is. */
export interface IBusRoute extends Document {
  organizationId: Types.ObjectId;
  eventId: Types.ObjectId;
  /** Short identifier printed for guests, e.g. "B03". */
  code: string;
  city: string;
  pickupPoint: string;
  departureAt: Date | null;
  /** Free text about the return trip (no fixed time: the captain coordinates it). */
  returnInfo: string;
  capacity: number;
  /** Seats held by active registrations; changed only by atomic $inc (reserve/release) or a recount. */
  seatsTaken: number;
  captainName: string;
  captainPhone: string;
  /** SHA-256 of the captain's access link token; the link itself is shown once. */
  captainTokenHash: string | null;
  captainTokenHint: string;
  notes: string;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const BusRouteSchema = new Schema<IBusRoute>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true, index: true },
    code: { type: String, required: true },
    city: { type: String, required: true },
    pickupPoint: { type: String, default: "" },
    departureAt: { type: Date, default: null },
    returnInfo: { type: String, default: "" },
    capacity: { type: Number, required: true, min: 0 },
    seatsTaken: { type: Number, default: 0, min: 0 },
    captainName: { type: String, default: "" },
    captainPhone: { type: String, default: "" },
    captainTokenHash: { type: String, default: null, index: true },
    captainTokenHint: { type: String, default: "" },
    notes: { type: String, default: "" },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

BusRouteSchema.index({ eventId: 1, code: 1 }, { unique: true });

export const BusRouteModel: Model<IBusRoute> =
  mongoose.models.TBookBusRoute ?? mongoose.model<IBusRoute>("TBookBusRoute", BusRouteSchema, "tbookbusroutes");

export const busLegs = ["outbound", "return"] as const;
export type BusLeg = (typeof busLegs)[number];
export const boardingStatuses = ["boarded", "not_boarded"] as const;
export type BoardingStatus = (typeof boardingStatuses)[number];

/**
 * Boarding is kept apart from venue check-in: one row per passenger per
 * leg, written by the captain (or an organizer).
 */
export interface IBusBoarding extends Document {
  organizationId: Types.ObjectId;
  eventId: Types.ObjectId;
  routeId: Types.ObjectId;
  bookingId: Types.ObjectId;
  /** The attendee's stable id, or "<bookingId>:<index>" for an attendee without one. */
  attendeeKey: string;
  leg: BusLeg;
  status: BoardingStatus;
  /** "captain:<route code>" or a user id. */
  markedBy: string;
  markedAt: Date;
}

const BusBoardingSchema = new Schema<IBusBoarding>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true },
    routeId: { type: Schema.Types.ObjectId, ref: "TBookBusRoute", required: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "TBookBooking", required: true },
    attendeeKey: { type: String, required: true },
    leg: { type: String, enum: busLegs, required: true },
    status: { type: String, enum: boardingStatuses, required: true },
    markedBy: { type: String, default: "" },
    markedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

BusBoardingSchema.index({ eventId: 1, attendeeKey: 1, leg: 1 }, { unique: true });

export const BusBoardingModel: Model<IBusBoarding> =
  mongoose.models.TBookBusBoarding ?? mongoose.model<IBusBoarding>("TBookBusBoarding", BusBoardingSchema, "tbookbusboardings");
