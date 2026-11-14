import QRCode from "qrcode";
import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { dataListRepository, eventGroupRepository, eventRepository, organizationRepository, voucherRepository, type IBooking, type IEvent } from "@tbook/db";
import { ELIGIBILITY_MATCH_OPS, isEligibilityMatchOp, matchesRuleConfig, normalizeListKey, type EligibilityRulesConfig } from "@tbook/domain";
import type { AttendeeFieldDef, AttendeeFieldValue } from "@tbook/schemas";
import {
  extensions,
  getDataListForOrg,
  renderVoucherPdfForBooking,
  resolveModules,
  resolveTicketAttendeeFieldSchema,
  sanitizeRichText,
  sendMail,
  type EventContext,
  type MailAttachment,
  type MailTransporter,
} from "@tbook/services";
import { listEventAttendees, givenName, toEventAttendees, type EventAttendee } from "../shared/attendees";
import {
  EmailDeliveryModel,
  EventEmailModel,
  idleState,
  isSystemEmailTrigger,
  type DeliveryMode,
  type EmailAudience,
  type EmailTrigger,
  type IEventEmail,
  type SystemEmailTrigger,
} from "./model";
import { QR_CID, fieldValues, renderEventEmail } from "./render";
import { systemEmailInfo, systemEmailSampleValues } from "./system";

export const EVENT_EMAILS = "event-emails";

/** Module settings (event config of "event-emails"). */
export interface EventEmailsConfig {
  /** Linked from every email as {{siteUrl}}. */
  siteUrl?: string;
  surveyUrl?: string;
  galleryUrl?: string;
  /** Greeting name order; Hungarian names are family-name first. */
  nameOrder?: "family_first" | "given_first";
}

const TIME_ZONE = "Europe/Budapest";
/** Pause between messages of a manual send, to stay under SMTP providers' rate limits. */
const SEND_DELAY_MS = Number(process.env.TBOOK_EMAIL_SEND_DELAY_MS ?? 250);
/** A "running" send whose heartbeat is older than this was interrupted (e.g. a restart). */
const STALE_AFTER_MS = 2 * 60 * 1000;

/** Test seam: a transport used when a caller passes none (tests and scripts; production uses SMTP). */
let defaultTransporter: MailTransporter | undefined;
export function setEventEmailTransporter(transporter: MailTransporter | undefined): void {
  defaultTransporter = transporter;
}

/**
 * Called after an email reached an attendee (automatic, manual, system):
 * modules record what the guest now knows (e.g. the bus captain's details).
 * Not called for test sends to an organizer's address.
 */
export type AttendeeEmailDeliveredHook = (email: IEventEmail, row: EventAttendee) => Promise<void>;
const deliveredHooks: AttendeeEmailDeliveredHook[] = [];
export function onAttendeeEmailDelivered(hook: AttendeeEmailDeliveredHook): void {
  if (!deliveredHooks.includes(hook)) deliveredHooks.push(hook);
}

async function deliveredToAttendee(email: IEventEmail, row: EventAttendee, ok: boolean): Promise<boolean> {
  if (!ok) return ok;
  for (const hook of deliveredHooks) {
    try {
      await hook(email, row);
    } catch (error) {
      console.error("[tbook] email delivered hook failed", String(email._id), row.attendeeKey, error);
    }
  }
  return ok;
}

// ---- CRUD ------------------------------------------------------------------------

export interface EventEmailInput {
  name: string;
  subject: string;
  body: string;
  trigger: EmailTrigger;
  audience: EmailAudience;
  listId?: string | null;
  listMatchFieldKey?: string | null;
  conditions?: EligibilityRulesConfig | null;
  attachTicket?: boolean;
  active?: boolean;
  sortOrder?: number;
}

export function listEventEmails(eventId: string): Promise<IEventEmail[]> {
  return EventEmailModel.find({ eventId }).sort({ sortOrder: 1, createdAt: 1 }).exec();
}

export async function getEventEmailForOrg(organizationId: string, emailId: string): Promise<IEventEmail> {
  const email = Types.ObjectId.isValid(emailId) ? await EventEmailModel.findById(emailId).exec() : null;
  if (!email || String(email.organizationId) !== organizationId) throw ActionError.notFound("Email not found");
  return email;
}

async function cleanInput(organizationId: string, input: EventEmailInput) {
  if (!input.name.trim()) throw ActionError.validation("Give the email a name.");
  if (!input.subject.trim()) throw ActionError.validation("Write a subject line.");
  const trigger = input.trigger;
  const system = isSystemEmailTrigger(trigger);
  // An automatic email always goes to the attendee who just registered; a system email to whoever the module addresses.
  const audience: EmailAudience = trigger === "on_registration" || system ? "registered" : input.audience;
  let listId: Types.ObjectId | null = null;
  if (audience !== "registered") {
    if (!input.listId) throw ActionError.validation("Choose the data list to send to.");
    const list = await getDataListForOrg(organizationId, input.listId);
    if (!list.emailColumn) throw ActionError.validation(`The list "${list.name}" has no email column. Re-import it and pick the email column.`);
    if (audience === "list_unregistered" && !input.listMatchFieldKey) {
      throw ActionError.validation("Choose which registration question holds the list's key (e.g. the employee ID).");
    }
    listId = list._id as Types.ObjectId;
  }
  const conditions = !system && input.conditions && input.conditions.rules.length > 0 ? input.conditions : null;
  // An unknown op would match everyone (the engine lets it pass): refuse it instead.
  for (const rule of conditions?.rules ?? []) {
    if (!isEligibilityMatchOp(rule.op)) throw ActionError.validation(`Unknown condition "${String(rule.op)}" (use one of: ${ELIGIBILITY_MATCH_OPS.join(", ")}).`);
  }
  return {
    name: input.name.trim(),
    subject: input.subject.trim(),
    body: sanitizeRichText(input.body ?? ""),
    trigger,
    audience,
    listId,
    listMatchFieldKey: audience === "list_unregistered" ? (input.listMatchFieldKey ?? null) : null,
    conditions,
    attachTicket: !system && Boolean(input.attachTicket),
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? 0,
  };
}

/** A system trigger has one template per event: the one the module uses. */
async function assertSingleSystemEmail(eventId: string, trigger: EmailTrigger, exceptId: string | null): Promise<void> {
  if (!isSystemEmailTrigger(trigger)) return;
  const other = await EventEmailModel.findOne({ eventId, trigger, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { name: 1 }).lean().exec();
  if (other) throw ActionError.validation(`This event already has the “${systemEmailInfo(trigger).label}” email (“${other.name}”). Edit that one instead.`);
}

export async function createEventEmail(organizationId: string, eventId: string, input: EventEmailInput): Promise<IEventEmail> {
  const clean = await cleanInput(organizationId, input);
  await assertSingleSystemEmail(eventId, clean.trigger, null);
  return EventEmailModel.create({ organizationId, eventId, ...clean, sendState: idleState() });
}

export async function updateEventEmail(organizationId: string, emailId: string, input: EventEmailInput): Promise<IEventEmail> {
  const email = await getEventEmailForOrg(organizationId, emailId);
  if (email.sendState?.status === "running" && !isStale(email)) throw ActionError.validation("This email is being sent right now. Stop the send before editing it.");
  const clean = await cleanInput(organizationId, input);
  await assertSingleSystemEmail(String(email.eventId), clean.trigger, emailId);
  const updated = await EventEmailModel.findByIdAndUpdate(emailId, clean, { returnDocument: "after" }).exec();
  return updated!;
}

export async function deleteEventEmail(organizationId: string, emailId: string): Promise<void> {
  const email = await getEventEmailForOrg(organizationId, emailId);
  if (email.sendState?.status === "running" && !isStale(email)) throw ActionError.validation("This email is being sent right now. Stop the send first.");
  await EmailDeliveryModel.deleteMany({ emailId }).exec();
  await EventEmailModel.deleteOne({ _id: emailId }).exec();
}

// ---- Rendering ------------------------------------------------------------------

function formatEventDate(event: IEvent): string {
  return new Intl.DateTimeFormat("hu-HU", { dateStyle: "long", timeZone: TIME_ZONE }).format(event.startDate);
}

function formatEventTime(event: IEvent): string {
  return [event.startTime, event.endTime].filter(Boolean).join("–");
}

export interface RenderContext {
  event: IEvent;
  organizationId: string;
  organizationName: string;
  config: EventEmailsConfig;
  extensionCtx: EventContext;
}

async function renderContextFor(event: IEvent): Promise<RenderContext> {
  const organizationId = String(event.organizationId ?? "");
  const groupId = event.groupId ? String(event.groupId) : null;
  const modules = await resolveModules({ organizationId: organizationId || null, groupId, event });
  const org = organizationId ? await organizationRepository.findById(organizationId) : null;
  return {
    event,
    organizationId,
    organizationName: org?.name ?? "",
    config: modules.config<EventEmailsConfig>(EVENT_EMAILS),
    extensionCtx: { event, organizationId: organizationId || null, groupId, modules },
  };
}

function baseValues(ctx: RenderContext): Record<string, string> {
  return {
    eventName: ctx.event.name,
    eventDate: formatEventDate(ctx.event),
    eventTime: formatEventTime(ctx.event),
    eventLocation: ctx.event.location?.address ?? "",
    siteUrl: ctx.config.siteUrl ?? "",
    surveyUrl: ctx.config.surveyUrl ?? "",
    galleryUrl: ctx.config.galleryUrl ?? "",
    organizationName: ctx.organizationName,
  };
}

function attendeeEmailAddress(row: EventAttendee): string {
  const schema = (row.booking.attendeeFieldSchema ?? []) as AttendeeFieldDef[];
  const emailField = schema.find((field) => field.type === "email");
  const own = emailField ? String(row.fields[emailField.key] ?? "").trim() : "";
  return own || row.booking.customer?.email || "";
}

interface OutgoingMessage {
  recipientKey: string;
  to: string;
  name: string;
  subject: string;
  html: string;
  attachments: MailAttachment[];
  bookingId: string | null;
  /** For a test booking's attendee: "[TESZT] " subject. */
  test?: boolean;
}

/** {{name}} / {{event}}: the names the modules' built-in texts use. */
function aliasValues(values: Record<string, string>): Record<string, string> {
  return { name: values.fullName ?? "", event: values.eventName ?? "" };
}

async function attendeeMessage(
  email: IEventEmail,
  ctx: RenderContext,
  row: EventAttendee,
  extra: Record<string, string> = {},
  template: { subject: string; body: string } = email,
): Promise<OutgoingMessage> {
  const schema = (row.booking.attendeeFieldSchema ?? []) as AttendeeFieldDef[];
  const values: Record<string, string> = {
    ...baseValues(ctx),
    fullName: row.displayName,
    firstName: givenName(row.displayName, ctx.config.nameOrder),
    registrationNumber: row.registrationNumber ?? row.booking.registrationNumber ?? "",
    customerName: row.booking.customer?.name ?? "",
    customerEmail: row.booking.customer?.email ?? "",
    ...fieldValues(schema, row.fields),
  };
  for (const provider of extensions.attendeePlaceholderProviders()) {
    if (!ctx.extensionCtx.modules.isOn(provider.moduleKey)) continue;
    Object.assign(values, await provider.values(ctx.extensionCtx, row.booking, row.index));
  }
  Object.assign(values, aliasValues(values), extra);

  const vouchers = await voucherRepository.findByBookingId(String(row.booking._id));
  const voucher = vouchers.find((v) => v.attendeeIndex === row.index && v.status !== "void");
  const rendered = renderEventEmail(template, values, Boolean(voucher));
  const attachments: MailAttachment[] = [];
  if (rendered.usesQr && voucher) {
    const png = await QRCode.toBuffer(voucher.token, { type: "png", width: 440, margin: 1, errorCorrectionLevel: "M" });
    attachments.push({ filename: "qr.png", content: png, contentType: "image/png", cid: QR_CID });
  }
  if (email.attachTicket && voucher) {
    const ticket = await renderVoucherPdfForBooking(String(row.booking._id), { attendeeIndexes: [row.index] });
    if (ticket) attachments.push({ filename: `${ctx.event.name.replace(/[^\w.-]+/g, "_")}-${row.registrationNumber ?? row.index + 1}.pdf`, content: Buffer.from(ticket.bytes), contentType: "application/pdf" });
  }
  return {
    recipientKey: row.attendeeKey,
    to: attendeeEmailAddress(row),
    name: row.displayName,
    subject: rendered.subject,
    html: rendered.html,
    attachments,
    bookingId: String(row.booking._id),
    test: Boolean(row.booking.isTest),
  };
}

interface ListRecipient {
  key: string;
  to: string;
  name: string;
  data: Record<string, string>;
}

function listMessage(email: IEventEmail, ctx: RenderContext, recipient: ListRecipient, extra: Record<string, string> = {}): OutgoingMessage {
  const values: Record<string, string> = {
    ...baseValues(ctx),
    fullName: recipient.name,
    firstName: givenName(recipient.name, ctx.config.nameOrder),
    ...Object.fromEntries(Object.entries(recipient.data).map(([key, value]) => [`list.${key}`, value])),
  };
  Object.assign(values, aliasValues(values), extra);
  const rendered = renderEventEmail(email, values, false);
  return { recipientKey: `list:${recipient.key}`, to: recipient.to, name: recipient.name, subject: rendered.subject, html: rendered.html, attachments: [], bookingId: null };
}

function matchesConditions(email: IEventEmail, row: EventAttendee): boolean {
  return matchesRuleConfig(email.conditions as EligibilityRulesConfig | null, row.fields, (row.booking.attendeeFieldSchema ?? []) as AttendeeFieldDef[]);
}

// ---- Recipients -----------------------------------------------------------------

async function listRecipients(email: IEventEmail, event: IEvent): Promise<ListRecipient[]> {
  const list = email.listId ? await dataListRepository.findById(String(email.listId)) : null;
  if (!list || !list.emailColumn) return [];
  let registeredKeys: Set<string> | null = null;
  if (email.audience === "list_unregistered" && email.listMatchFieldKey) {
    registeredKeys = new Set();
    for (const row of await listEventAttendees(String(event._id))) {
      const key = normalizeListKey(row.fields[email.listMatchFieldKey], list.keyNormalization);
      if (key) registeredKeys.add(key);
    }
  }
  const recipients: ListRecipient[] = [];
  const seenEmails = new Set<string>();
  for await (const row of dataListRepository.cursorRows(String(list._id))) {
    if (registeredKeys?.has(row.key)) continue;
    const data = row.data as Record<string, string>;
    const to = String(data[list.emailColumn] ?? "").trim().toLowerCase();
    if (!to || !to.includes("@") || seenEmails.has(to)) continue;
    seenEmails.add(to);
    recipients.push({ key: row.key, to, name: list.nameColumn ? String(data[list.nameColumn] ?? "") : "", data });
  }
  return recipients;
}

/** How many people a manual send would reach right now (before skipping those already sent). */
export async function countEmailRecipients(organizationId: string, emailId: string): Promise<number> {
  const email = await getEventEmailForOrg(organizationId, emailId);
  const event = await eventRepository.findById(String(email.eventId));
  if (!event) return 0;
  if (email.audience === "registered") return (await listEventAttendees(String(event._id))).filter((row) => matchesConditions(email, row)).length;
  return (await listRecipients(email, event)).length;
}

// ---- Sending --------------------------------------------------------------------

async function deliver(email: IEventEmail, message: OutgoingMessage, mode: DeliveryMode, transporter?: MailTransporter): Promise<boolean> {
  let error: string | null = null;
  if (!message.to) error = "No email address.";
  else {
    try {
      await sendMail(
        String(email.organizationId),
        { to: message.to, subject: message.subject, html: message.html, attachments: message.attachments, test: message.test },
        transporter ?? defaultTransporter,
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  if (mode !== "test") {
    await EmailDeliveryModel.updateOne(
      { emailId: email._id, recipientKey: message.recipientKey },
      {
        $set: {
          organizationId: email.organizationId,
          eventId: email.eventId,
          to: message.to || "—",
          name: message.name,
          status: error ? "failed" : "sent",
          error,
          mode,
          bookingId: message.bookingId ? new Types.ObjectId(message.bookingId) : null,
          sentAt: new Date(),
        },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    ).exec();
  }
  return !error;
}

/**
 * The automatic step: after a registration is confirmed, each active
 * "on_registration" email goes to each attendee matching its conditions.
 * An attendee already sent an email doesn't get it again.
 */
export async function sendAutomaticEmailsForBooking(booking: IBooking, transporter?: MailTransporter, onlyAttendeeKey?: string): Promise<void> {
  const event = await eventRepository.findById(String(booking.eventId));
  if (!event) return;
  const ctx = await renderContextFor(event);
  if (!ctx.extensionCtx.modules.isOn(EVENT_EMAILS)) return;
  const emails = (await listEventEmails(String(event._id))).filter((email) => email.trigger === "on_registration" && email.active);
  if (emails.length === 0) return;
  const rows = toEventAttendees(booking).filter((row) => !onlyAttendeeKey || row.attendeeKey === onlyAttendeeKey);
  for (const email of emails) {
    for (const row of rows) {
      if (!matchesConditions(email, row)) continue;
      const already = await EmailDeliveryModel.exists({ emailId: email._id, recipientKey: row.attendeeKey, status: "sent" });
      if (already) continue;
      try {
        await deliveredToAttendee(email, row, await deliver(email, await attendeeMessage(email, ctx, row), "auto", transporter));
      } catch (error) {
        console.error("[tbook] automatic event email failed", String(email._id), row.attendeeKey, error);
      }
    }
  }
}

/** True when the event has an active automatic email, so the default booking email is skipped. */
export async function hasAutomaticConfirmation(booking: IBooking): Promise<boolean> {
  const event = await eventRepository.findById(String(booking.eventId));
  if (!event) return false;
  const modules = await resolveModules({ organizationId: booking.organizationId ? String(booking.organizationId) : null, event });
  if (!modules.isOn(EVENT_EMAILS)) return false;
  return Boolean(await EventEmailModel.exists({ eventId: event._id, trigger: "on_registration", active: true }));
}

function isStale(email: IEventEmail): boolean {
  const beat = email.sendState?.heartbeatAt ? new Date(email.sendState.heartbeatAt).getTime() : 0;
  return Date.now() - beat > STALE_AFTER_MS;
}

export interface StartSendOptions {
  /** Send again to people who already received it. Default: only those not yet sent (and failed ones). */
  resendAll?: boolean;
  transporter?: MailTransporter;
  /** Await the whole send (tests, scripts). The console starts it in the background. */
  wait?: boolean;
}

/**
 * Starts a manual send. Runs in the server process in the background; the
 * console polls the progress. Recipients already sent successfully are
 * skipped, so pressing Send again (or after an interruption) only finishes
 * the remainder.
 */
export async function startEventEmailSend(organizationId: string, emailId: string, userId: string | null, opts: StartSendOptions = {}): Promise<void> {
  const email = await getEventEmailForOrg(organizationId, emailId);
  if (email.trigger !== "manual") throw ActionError.validation("Automatic emails are sent on registration. Use a test send to check one.");
  if (email.sendState?.status === "running" && !isStale(email)) throw ActionError.validation("This email is already being sent.");
  const claimed = await EventEmailModel.findOneAndUpdate(
    { _id: email._id, $or: [{ "sendState.status": { $ne: "running" } }, { "sendState.heartbeatAt": { $lt: new Date(Date.now() - STALE_AFTER_MS) } }] },
    { $set: { sendState: { ...idleState(), status: "running", startedAt: new Date(), heartbeatAt: new Date(), startedBy: userId } } },
    { returnDocument: "after" },
  ).exec();
  if (!claimed) throw ActionError.validation("This email is already being sent.");
  const run = runSend(claimed, opts).catch(async (error) => {
    console.error("[tbook] event email send failed", emailId, error);
    await EventEmailModel.updateOne({ _id: emailId }, { $set: { "sendState.status": "stopped", "sendState.finishedAt": new Date() } }).exec();
  });
  if (opts.wait) await run;
}

export async function stopEventEmailSend(organizationId: string, emailId: string): Promise<void> {
  await getEventEmailForOrg(organizationId, emailId);
  await EventEmailModel.updateOne({ _id: emailId, "sendState.status": "running" }, { $set: { "sendState.status": "stopped", "sendState.finishedAt": new Date() } }).exec();
}

async function runSend(email: IEventEmail, opts: StartSendOptions): Promise<void> {
  const event = await eventRepository.findById(String(email.eventId));
  if (!event) throw new Error("Event not found");
  const ctx = await renderContextFor(event);

  const builders: Array<{ key: string; build: () => Promise<OutgoingMessage>; row?: EventAttendee }> = [];
  if (email.audience === "registered") {
    for (const row of await listEventAttendees(String(event._id))) {
      if (matchesConditions(email, row)) builders.push({ key: row.attendeeKey, build: () => attendeeMessage(email, ctx, row), row });
    }
  } else {
    for (const recipient of await listRecipients(email, event)) {
      builders.push({ key: `list:${recipient.key}`, build: async () => listMessage(email, ctx, recipient) });
    }
  }

  const alreadySent = opts.resendAll
    ? new Set<string>()
    : new Set((await EmailDeliveryModel.find({ emailId: email._id, status: "sent" }, { recipientKey: 1 }).lean().exec()).map((d) => d.recipientKey));

  const state = { total: builders.length, sent: 0, failed: 0, skipped: 0 };
  await EventEmailModel.updateOne({ _id: email._id }, { $set: { "sendState.total": state.total } }).exec();

  for (const [index, builder] of builders.entries()) {
    if (alreadySent.has(builder.key)) {
      state.skipped += 1;
    } else {
      const ok = await deliver(email, await builder.build(), "manual", opts.transporter).catch(() => false);
      if (builder.row) await deliveredToAttendee(email, builder.row, ok);
      if (ok) state.sent += 1;
      else state.failed += 1;
      if (SEND_DELAY_MS > 0 && !opts.transporter && !defaultTransporter) await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
    }
    if (index % 10 === 9 || index === builders.length - 1) {
      const current = await EventEmailModel.findById(email._id, { sendState: 1 }).lean().exec();
      if (current?.sendState?.status !== "running") return; // stopped by an organizer
      await EventEmailModel.updateOne(
        { _id: email._id },
        { $set: { "sendState.sent": state.sent, "sendState.failed": state.failed, "sendState.skipped": state.skipped, "sendState.heartbeatAt": new Date() } },
      ).exec();
    }
  }
  await EventEmailModel.updateOne(
    { _id: email._id },
    { $set: { "sendState.status": "done", "sendState.sent": state.sent, "sendState.failed": state.failed, "sendState.skipped": state.skipped, "sendState.finishedAt": new Date(), "sendState.heartbeatAt": new Date() } },
  ).exec();
}

/**
 * Sends one copy to `to`, filled with the first real recipient's data (or
 * sample data when there is none yet), so an organizer can check it before
 * the real send. Not recorded in the send log.
 */
export async function sendEventEmailTest(organizationId: string, emailId: string, to: string, transporter?: MailTransporter): Promise<string> {
  const email = await getEventEmailForOrg(organizationId, emailId);
  const event = await eventRepository.findById(String(email.eventId));
  if (!event) throw ActionError.notFound("Event not found");
  const address = to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw ActionError.validation("Enter a valid email address.");
  const ctx = await renderContextFor(event);
  let message: OutgoingMessage;
  let basedOn = "sample data";
  // A system email: its own placeholders ({{position}}, {{link}}, …) get sample values.
  const extra = isSystemEmailTrigger(email.trigger) ? systemEmailSampleValues(email.trigger) : {};
  if (email.audience === "registered") {
    const row = (await listEventAttendees(String(event._id))).find((r) => matchesConditions(email, r));
    if (row) {
      message = await attendeeMessage(email, ctx, row, { ...extra, ...(extra.registrationNumber ? { registrationNumber: row.registrationNumber ?? extra.registrationNumber } : {}) });
      basedOn = row.displayName;
    } else {
      message = listMessage(email, ctx, { key: "sample", to: address, name: "Minta Vendég", data: {} }, extra);
    }
  } else {
    const recipient = (await listRecipients(email, event))[0];
    message = listMessage(email, ctx, recipient ?? { key: "sample", to: address, name: "Minta Vendég", data: {} });
    if (recipient) basedOn = recipient.name || recipient.to;
  }
  const ok = await deliver(email, { ...message, to: address, subject: `[TESZT] ${message.subject}` }, "test", transporter);
  if (!ok) throw ActionError.validation("The test email couldn't be sent. Check the SMTP settings.");
  return basedOn;
}

export interface DeliveryRow {
  to: string;
  name: string;
  status: "sent" | "failed";
  error: string | null;
  mode: DeliveryMode;
  attempts: number;
  sentAt: Date;
}

export async function listEmailDeliveries(
  organizationId: string,
  emailId: string,
  opts: { status?: "sent" | "failed"; limit?: number; skip?: number } = {},
): Promise<{ rows: DeliveryRow[]; total: number; sent: number; failed: number }> {
  const email = await getEventEmailForOrg(organizationId, emailId);
  const filter: Record<string, unknown> = { emailId: email._id };
  if (opts.status) filter.status = opts.status;
  const [rows, total, sent, failed] = await Promise.all([
    EmailDeliveryModel.find(filter).sort({ sentAt: -1 }).skip(opts.skip ?? 0).limit(opts.limit ?? 100).lean().exec(),
    EmailDeliveryModel.countDocuments(filter).exec(),
    EmailDeliveryModel.countDocuments({ emailId: email._id, status: "sent" }).exec(),
    EmailDeliveryModel.countDocuments({ emailId: email._id, status: "failed" }).exec(),
  ]);
  return {
    rows: rows.map((row) => ({ to: row.to, name: row.name, status: row.status, error: row.error, mode: row.mode, attempts: row.attempts, sentAt: row.sentAt })),
    total,
    sent,
    failed,
  };
}

/** Re-sends the automatic emails of one booking (admin "resend confirmation"). */
export async function resendAutomaticEmails(organizationId: string, booking: IBooking, transporter?: MailTransporter): Promise<void> {
  if (String(booking.organizationId) !== organizationId) throw ActionError.notFound("Booking not found");
  const automatic = await EventEmailModel.find({ eventId: booking.eventId, trigger: "on_registration" }, { _id: 1 }).lean().exec();
  await EmailDeliveryModel.deleteMany({ bookingId: booking._id, mode: "auto", emailId: { $in: automatic.map((email) => email._id) } }).exec();
  await sendAutomaticEmailsForBooking(booking, transporter);
}

/** The question keys an email's conditions look at. */
function conditionFieldKeys(email: IEventEmail): Set<string> {
  const rules = (email.conditions as EligibilityRulesConfig | null)?.rules ?? [];
  return new Set(rules.map((rule) => String(rule.fieldKey ?? "").trim()).filter(Boolean));
}

function changedFieldKeys(before: EventAttendee | undefined, after: EventAttendee): Set<string> {
  const previous = before?.fields ?? {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(after.fields)]);
  return new Set([...keys].filter((key) => String(previous[key] ?? "") !== String(after.fields[key] ?? "")));
}

/**
 * After a confirmed registration was edited (by the guest or an
 * organizer): an automatic email goes (again) to an attendee only when the
 * attendee matches its conditions now AND either a question its conditions
 * look at changed, or the attendee's email address changed. An email
 * without conditions goes again only on an address change. So picking a
 * bus later (or switching bus A → B) sends the bus email, not the general
 * confirmation; other attendees of the booking get nothing.
 */
export async function sendAutomaticEmailsAfterEdit(before: IBooking, after: IBooking, transporter?: MailTransporter): Promise<void> {
  const event = await eventRepository.findById(String(after.eventId));
  if (!event) return;
  const ctx = await renderContextFor(event);
  if (!ctx.extensionCtx.modules.isOn(EVENT_EMAILS)) return;
  const emails = (await listEventEmails(String(event._id))).filter((email) => email.trigger === "on_registration" && email.active);
  if (emails.length === 0) return;
  const previous = toEventAttendees(before);
  for (const row of toEventAttendees(after)) {
    const old = previous.find((candidate) => candidate.attendeeKey === row.attendeeKey) ?? previous[row.index];
    const changed = changedFieldKeys(old, row);
    const addressChanged = !old || attendeeEmailAddress(old).trim().toLowerCase() !== attendeeEmailAddress(row).trim().toLowerCase();
    if (changed.size === 0 && !addressChanged) continue;
    for (const email of emails) {
      if (!matchesConditions(email, row)) continue;
      const relevant = addressChanged || [...conditionFieldKeys(email)].some((key) => changed.has(key));
      if (!relevant) continue;
      try {
        await deliveredToAttendee(email, row, await deliver(email, await attendeeMessage(email, ctx, row), "auto", transporter));
      } catch (error) {
        console.error("[tbook] automatic event email after an edit failed", String(email._id), row.attendeeKey, error);
      }
    }
  }
}

// ---- System emails ----------------------------------------------------------------

/**
 * What a module does with one of its guest messages (waitlist, bus seat
 * freed, cancellation), decided by the event's template of that trigger:
 *  - "on": the event has an active template → it is sent (`sendSystemEmail…`);
 *  - "off": the template exists but is switched off → nothing is sent;
 *  - "default": no template (or event emails are off for the event) → the
 *    module sends its own text (module settings text, else the built-in one).
 */
export type SystemEmailPlan = { state: "default" } | { state: "off" } | { state: "on"; email: IEventEmail; ctx: RenderContext };

export async function systemEmailPlan(event: IEvent, trigger: SystemEmailTrigger): Promise<SystemEmailPlan> {
  const email = await EventEmailModel.findOne({ eventId: event._id, trigger }).sort({ createdAt: 1 }).exec();
  if (!email) return { state: "default" };
  const ctx = await renderContextFor(event);
  if (!ctx.extensionCtx.modules.isOn(EVENT_EMAILS)) return { state: "default" };
  return email.active ? { state: "on", email, ctx } : { state: "off" };
}

const BUS_NOTE_TOKEN = /\{\{\s*busNote\s*\}\}/;
const BUS_NOTE_PARAGRAPH = /<p>\s*\{\{\s*busNote\s*\}\}\s*<\/p>/g;

/**
 * {{busNote}}: a note the template doesn't place itself is added as a last
 * paragraph; without a note, a paragraph holding only the placeholder goes.
 */
function withNote(email: IEventEmail, extra: Record<string, string>): { subject: string; body: string } {
  if (!extra.busNote) return BUS_NOTE_TOKEN.test(email.body) ? { subject: email.subject, body: email.body.replace(BUS_NOTE_PARAGRAPH, "") } : email;
  if (BUS_NOTE_TOKEN.test(email.body)) return email;
  return { subject: email.subject, body: `${email.body}<p>{{busNote}}</p>` };
}

/** To one attendee of a booking (bus seat freed, cancellation); logged like the automatic emails. */
export async function sendSystemEmailToAttendee(
  plan: Extract<SystemEmailPlan, { state: "on" }>,
  row: EventAttendee,
  opts: { extra?: Record<string, string>; transporter?: MailTransporter; test?: boolean } = {},
): Promise<boolean> {
  const extra = opts.extra ?? {};
  const cancelled = plan.email.trigger === "booking_cancelled";
  const template = withNote(plan.email, extra);
  // A cancelled guest's ticket is void: no ticket, no QR.
  const message = await attendeeMessage(plan.email, plan.ctx, row, extra, cancelled ? { subject: template.subject, body: template.body.replace(/\{\{\s*qrCode\s*\}\}/g, "") } : template);
  const outgoing = { ...message, attachments: cancelled ? [] : message.attachments };
  return deliveredToAttendee(plan.email, row, await deliver(plan.email, opts.test ? { ...outgoing, test: true } : outgoing, "auto", opts.transporter));
}

export interface SystemEmailContact {
  /** Delivery log key, e.g. "waitlist:<entry id>". */
  key: string;
  to: string;
  name: string;
  email?: string;
  test?: boolean;
  /** The first attendee's answers ({{field.*}}). */
  fields?: Record<string, AttendeeFieldValue>;
}

/** To a contact who isn't (yet) a registered attendee — the waitlist entry's contact. */
export async function sendSystemEmailToContact(
  plan: Extract<SystemEmailPlan, { state: "on" }>,
  contact: SystemEmailContact,
  opts: { extra?: Record<string, string>; transporter?: MailTransporter } = {},
): Promise<boolean> {
  const { ctx, email } = plan;
  const extra = opts.extra ?? {};
  const group = ctx.event.groupId ? await eventGroupRepository.findById(String(ctx.event.groupId)) : null;
  const schema = resolveTicketAttendeeFieldSchema({
    registrationUnit: ctx.event.registrationUnit,
    groupSchema: group?.defaultAttendeeFieldSchema as AttendeeFieldDef[] | undefined,
    eventSchema: ctx.event.attendeeFieldSchema as AttendeeFieldDef[],
    mode: ctx.event.attendeeFieldSchemaMode,
  });
  const values: Record<string, string> = {
    ...baseValues(ctx),
    fullName: contact.name,
    firstName: givenName(contact.name, ctx.config.nameOrder),
    customerName: contact.name,
    customerEmail: contact.email ?? contact.to,
    registrationNumber: "",
    ...fieldValues(schema, contact.fields ?? {}),
  };
  Object.assign(values, aliasValues(values), extra);
  const rendered = renderEventEmail(withNote(email, extra), values, false);
  return deliver(
    email,
    { recipientKey: contact.key, to: contact.to, name: contact.name, subject: rendered.subject, html: rendered.html, attachments: [], bookingId: null, test: Boolean(contact.test) },
    "auto",
    opts.transporter,
  );
}
