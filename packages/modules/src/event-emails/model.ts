import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

/**
 * An email an organizer defines for an event. Kinds of trigger:
 *  - "on_registration": sent automatically to each attendee when a
 *    registration is confirmed (optionally only to attendees matching
 *    `conditions`, e.g. those who chose a bus);
 *  - "manual": sent when an organizer presses Send (there is no scheduler:
 *    "Nov 20 reminder" means pressing Send on Nov 20);
 *  - a system trigger (see `systemEmailTriggers`): the event's own text for
 *    a message a module sends (waitlist, bus seat freed, cancellation). At
 *    most one per trigger and event; inactive = that message isn't sent at
 *    all; no template = the module's built-in text.
 */
export const systemEmailTriggers = ["waitlist_joined", "waitlist_offer", "waitlist_registered", "bus_seat_freed", "booking_cancelled"] as const;
export type SystemEmailTrigger = (typeof systemEmailTriggers)[number];

export const emailTriggers = ["on_registration", "manual", ...systemEmailTriggers] as const;
export type EmailTrigger = (typeof emailTriggers)[number];

export function isSystemEmailTrigger(trigger: unknown): trigger is SystemEmailTrigger {
  return (systemEmailTriggers as readonly unknown[]).includes(trigger);
}

/**
 * Who a manual email goes to:
 *  - "registered": every registered attendee (filtered by `conditions`);
 *  - "list_all": every row of a data list with an email address;
 *  - "list_unregistered": data-list rows nobody has registered with yet.
 */
export const emailAudiences = ["registered", "list_all", "list_unregistered"] as const;
export type EmailAudience = (typeof emailAudiences)[number];

export const sendStatuses = ["idle", "running", "done", "stopped"] as const;
export type SendStatus = (typeof sendStatuses)[number];

export interface EmailSendState {
  status: SendStatus;
  total: number;
  sent: number;
  failed: number;
  /** Already sent earlier, not sent again. */
  skipped: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Updated while sending; a "running" state with an old heartbeat was interrupted (server restart). */
  heartbeatAt: Date | null;
  startedBy: string | null;
}

export interface IEventEmail extends Document {
  organizationId: Types.ObjectId;
  eventId: Types.ObjectId;
  name: string;
  subject: string;
  body: string;
  trigger: EmailTrigger;
  audience: EmailAudience;
  listId: Types.ObjectId | null;
  /** The registration field holding the data list's key (for "list_unregistered"). */
  listMatchFieldKey: string | null;
  /** Rule set over attendee answers (the registration rule engine's shape). */
  conditions: { logic: "and" | "or"; rules: Array<{ id: string; fieldKey: string; op: string; value: string; message?: string }> } | null;
  attachTicket: boolean;
  /** Automatic emails send only while active. */
  active: boolean;
  sortOrder: number;
  sendState: EmailSendState;
  createdAt: Date;
  updatedAt: Date;
}

const idleState = (): EmailSendState => ({
  status: "idle",
  total: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  startedAt: null,
  finishedAt: null,
  heartbeatAt: null,
  startedBy: null,
});

const EventEmailSchema = new Schema<IEventEmail>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true, index: true },
    name: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, default: "" },
    trigger: { type: String, enum: emailTriggers, required: true },
    audience: { type: String, enum: emailAudiences, default: "registered" },
    listId: { type: Schema.Types.ObjectId, ref: "TBookDataList", default: null },
    listMatchFieldKey: { type: String, default: null },
    conditions: { type: Schema.Types.Mixed, default: null },
    attachTicket: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    sendState: { type: Schema.Types.Mixed, default: idleState },
  },
  { timestamps: true, minimize: false },
);

export const EventEmailModel: Model<IEventEmail> =
  mongoose.models.TBookEventEmail ?? mongoose.model<IEventEmail>("TBookEventEmail", EventEmailSchema, "tbookeventemails");

export { idleState };

export const deliveryStatuses = ["sent", "failed"] as const;
export type DeliveryStatus = (typeof deliveryStatuses)[number];
export const deliveryModes = ["auto", "manual", "test"] as const;
export type DeliveryMode = (typeof deliveryModes)[number];

/** One recipient of one email: the send log organizers check for delivery problems. */
export interface IEmailDelivery extends Document {
  organizationId: Types.ObjectId;
  eventId: Types.ObjectId;
  emailId: Types.ObjectId;
  /** Attendee key, "list:<row key>", or "test:<address>". */
  recipientKey: string;
  to: string;
  name: string;
  status: DeliveryStatus;
  error: string | null;
  mode: DeliveryMode;
  bookingId: Types.ObjectId | null;
  attempts: number;
  sentAt: Date;
}

const EmailDeliverySchema = new Schema<IEmailDelivery>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true, index: true },
    emailId: { type: Schema.Types.ObjectId, ref: "TBookEventEmail", required: true },
    recipientKey: { type: String, required: true },
    to: { type: String, required: true },
    name: { type: String, default: "" },
    status: { type: String, enum: deliveryStatuses, required: true },
    error: { type: String, default: null },
    mode: { type: String, enum: deliveryModes, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "TBookBooking", default: null },
    attempts: { type: Number, default: 1 },
    sentAt: { type: Date, required: true },
  },
  { timestamps: false },
);

EmailDeliverySchema.index({ emailId: 1, recipientKey: 1 }, { unique: true });
EmailDeliverySchema.index({ emailId: 1, status: 1 });

export const EmailDeliveryModel: Model<IEmailDelivery> =
  mongoose.models.TBookEmailDelivery ?? mongoose.model<IEmailDelivery>("TBookEmailDelivery", EmailDeliverySchema, "tbookemaildeliveries");
