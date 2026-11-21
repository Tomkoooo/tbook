import ExcelJS from "exceljs";
import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { eventRepository, type IEvent } from "@tbook/db";
import { closingOf, expectedClosing, lineTotals, summarizeStand, type StandDayData, type StandLine, type StandSummary } from "@tbook/domain";
import { resolveModules, sendMail, type MailTransporter } from "@tbook/services";
import { escapeHtml, moduleMailTransporter } from "../shared/mail";
import { StandDayModel, StandEntryModel, StandProductModel, StandWithdrawalModel, type IStandDay, type IStandEntry, type IStandLine, type IStandProduct, type IStandWithdrawal, type StandCounter } from "./model";

export const STAND_MODE = "stand-mode";
export const DEFAULT_PACKS = [6, 10, 12, 20];

/** The practice day's key. Not a real date, so it can't collide with (or sort among) real days. */
export const SANDBOX_DATE = "SANDBOX";
/** Real days only: everything that reads history, stats or openings uses this. */
const REAL = { sandbox: { $ne: true } } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const oid = (value: string) => new Types.ObjectId(value);

export function todayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(now);
}

export interface StandSettings {
  /** Where closing reports go by default. */
  reportEmail: string;
  packs: number[];
}

export async function standSettings(event: IEvent): Promise<StandSettings> {
  const modules = await resolveModules({ organizationId: event.organizationId ? String(event.organizationId) : null, event });
  const config = modules.config<{ reportEmail?: string; packs?: string }>(STAND_MODE);
  const packs = String(config.packs ?? "")
    .split(/[ ,;]+/)
    .map((p) => Math.floor(Number(p)))
    .filter((p) => p > 0 && p <= 999);
  return { reportEmail: String(config.reportEmail ?? "").trim(), packs: packs.length ? packs : DEFAULT_PACKS };
}

export async function standEventForOrg(organizationId: string, eventId: string): Promise<IEvent> {
  const event = await eventRepository.findById(eventId);
  if (!event || String(event.organizationId) !== organizationId) throw ActionError.notFound("Event not found");
  const modules = await resolveModules({ organizationId, event });
  if (!modules.isOn(STAND_MODE)) throw ActionError.validation("Switch on Stand mode for this event first.");
  return event;
}

// ---- Products ------------------------------------------------------------------------

export interface StandProductInput {
  name: string;
  category: string;
  priceHuf: number;
  depositHuf?: number;
  costHuf?: number | null;
  image?: string;
  quickAdds?: number[];
  active?: boolean;
}

function cleanProduct(input: StandProductInput) {
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) throw ActionError.validation("Name the product.");
  const whole = (v: unknown) => Math.round(Number(v));
  const priceHuf = whole(input.priceHuf);
  const depositHuf = whole(input.depositHuf ?? 0);
  if (!Number.isFinite(priceHuf) || priceHuf < 0) throw ActionError.validation("The price must be 0 or more.");
  if (!Number.isFinite(depositHuf) || depositHuf < 0) throw ActionError.validation("The deposit must be 0 or more.");
  if (depositHuf > priceHuf) throw ActionError.validation("The deposit (visszaváltási érték) is part of the price, so it can't be higher.");
  let costHuf: number | null = null;
  if (input.costHuf !== null && input.costHuf !== undefined && String(input.costHuf) !== "") {
    costHuf = whole(input.costHuf);
    if (!Number.isFinite(costHuf) || costHuf < 0) throw ActionError.validation("The purchase price must be 0 or more.");
  }
  const image = String(input.image ?? "").trim();
  if (image && !/^https?:\/\/\S+$/.test(image) && !/^\/media\/[a-f0-9]{64}\.webp$/.test(image)) throw ActionError.validation("The image must be an uploaded image or an http(s) link.");
  return {
    name,
    category: input.category === "food" ? ("food" as const) : ("drink" as const),
    priceHuf,
    depositHuf,
    costHuf,
    image,
    quickAdds: [...new Set((input.quickAdds ?? []).map(whole).filter((n) => n > 0 && n <= 9999))].slice(0, 8),
    active: input.active ?? true,
  };
}

export function listProducts(eventId: string, opts: { activeOnly?: boolean } = {}): Promise<IStandProduct[]> {
  return StandProductModel.find({ eventId, ...(opts.activeOnly ? { active: true } : {}) })
    .sort({ category: 1, sortOrder: 1, name: 1 })
    .exec();
}

export async function saveProduct(organizationId: string, eventId: string, productId: string | null, input: StandProductInput): Promise<IStandProduct> {
  await standEventForOrg(organizationId, eventId);
  const data = cleanProduct(input);
  if (!productId) return StandProductModel.create({ ...data, organizationId, eventId });
  const updated = await StandProductModel.findOneAndUpdate({ _id: productId, organizationId, eventId }, { $set: data }, { returnDocument: "after" }).exec();
  if (!updated) throw ActionError.notFound("Product not found");
  // An open day keeps selling at the price it opened with, except that a
  // price fix should apply right away: refresh the open day's snapshot.
  await StandDayModel.updateMany(
    { eventId, status: "open", "lines.productId": updated._id },
    { $set: { "lines.$[l].name": data.name, "lines.$[l].priceHuf": data.priceHuf, "lines.$[l].depositHuf": data.depositHuf, "lines.$[l].costHuf": data.costHuf, "lines.$[l].image": data.image } },
    { arrayFilters: [{ "l.productId": updated._id }] },
  ).exec();
  return updated;
}

/** Products used on past days are switched off instead of deleted. */
export async function deleteProduct(organizationId: string, eventId: string, productId: string): Promise<"deleted" | "deactivated"> {
  await standEventForOrg(organizationId, eventId);
  const used = await StandDayModel.exists({ eventId, ...REAL, "lines.productId": productId });
  if (used) {
    await StandProductModel.updateOne({ _id: productId, organizationId, eventId }, { $set: { active: false } }).exec();
    return "deactivated";
  }
  await StandProductModel.deleteOne({ _id: productId, organizationId, eventId }).exec();
  return "deleted";
}

// ---- Days ----------------------------------------------------------------------------

export function getDay(eventId: string, date: string): Promise<IStandDay | null> {
  return StandDayModel.findOne({ eventId, date }).exec();
}

export async function getDayForOrg(organizationId: string, dayId: string): Promise<IStandDay> {
  const day = await StandDayModel.findOne({ _id: dayId, organizationId }).exec();
  if (!day) throw ActionError.notFound("Day not found");
  return day;
}

export function getOpenDay(eventId: string): Promise<IStandDay | null> {
  return StandDayModel.findOne({ eventId, ...REAL, status: "open" }).sort({ date: -1 }).exec();
}

export function getSandboxDay(eventId: string): Promise<IStandDay | null> {
  return StandDayModel.findOne({ eventId, sandbox: true }).exec();
}

export function listDays(eventId: string, limit = 60): Promise<IStandDay[]> {
  return StandDayModel.find({ eventId, ...REAL }).sort({ date: -1 }).limit(limit).exec();
}

/** The latest closed day before `date`: where today's opening inventory comes from. */
export function previousClosedDay(eventId: string, date: string): Promise<IStandDay | null> {
  return StandDayModel.findOne({ eventId, ...REAL, status: "closed", date: { $lt: date } }).sort({ date: -1 }).exec();
}

export interface OpeningProposal {
  productId: string;
  name: string;
  category: "drink" | "food";
  opening: number;
  /** Came from the previous day's closing inventory. */
  fromPrevious: boolean;
}

/** Opening counts for every active product: last closing where there is one, else 0. */
export async function proposeOpening(eventId: string, date: string): Promise<{ previousDate: string | null; /** The previous day's float, as a starting point. */ floatHuf: number; items: OpeningProposal[] }> {
  const [products, previous] = await Promise.all([listProducts(eventId, { activeOnly: true }), previousClosedDay(eventId, date)]);
  const closing = new Map<string, number>();
  for (const line of previous?.lines ?? []) closing.set(String(line.productId), Math.max(0, closingOf(toDomain(line))));
  return {
    previousDate: previous?.date ?? null,
    floatHuf: previous?.floatHuf ?? 0,
    items: products.map((p) => ({
      productId: String(p._id),
      name: p.name,
      category: p.category,
      opening: closing.get(String(p._id)) ?? 0,
      fromPrevious: closing.has(String(p._id)),
    })),
  };
}

function snapshot(product: IStandProduct, opening: number): IStandLine {
  return {
    productId: product._id as Types.ObjectId,
    name: product.name,
    category: product.category,
    priceHuf: product.priceHuf,
    depositHuf: product.depositHuf,
    costHuf: product.costHuf,
    image: product.image,
    opening,
    restocked: 0,
    soldCash: 0,
    soldCard: 0,
    internal: 0,
    internalOutside: 0,
    counted: null,
  };
}

/** Money in whole forints (a day's takings are far above any item count). */
const money = (v: unknown, label: string) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw ActionError.validation(`${label} must be a whole amount in forints, 0 or more.`);
  return n;
};

/** Nothing entered (the field was left empty). */
const emptyCount = (v: unknown) => v === undefined || v === null || v === "" || (typeof v === "number" && Number.isNaN(v));

const count = (v: unknown) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw ActionError.validation("Counts must be whole numbers, 0 or more.");
  return n;
};

export async function openDay(
  organizationId: string,
  eventId: string,
  input: { date?: string; devices?: boolean; sandbox?: boolean; floatHuf?: number; openings?: Record<string, number> },
): Promise<IStandDay> {
  await standEventForOrg(organizationId, eventId);
  const sandbox = Boolean(input.sandbox);
  const date = sandbox ? SANDBOX_DATE : (input.date ?? todayKey());
  if (!sandbox) {
    if (!DATE.test(date)) throw ActionError.validation("Invalid date.");
    if (await StandDayModel.exists({ eventId, date })) throw ActionError.validation("This day already exists.");
    if (await StandDayModel.exists({ eventId, ...REAL, status: "open" })) throw ActionError.validation("Close the day that is still open first.");
  }
  // Practice openings default from the last real closing too; nothing is written back.
  const proposal = await proposeOpening(eventId, sandbox ? todayKey() : date);
  const products = await listProducts(eventId, { activeOnly: true });
  if (products.length === 0) throw ActionError.validation("Add products first.");
  const lines = products.map((p) => {
    const given = input.openings?.[String(p._id)];
    const fallback = proposal.items.find((i) => i.productId === String(p._id))?.opening ?? 0;
    return snapshot(p, given === undefined ? fallback : count(given));
  });
  // A new practice run replaces the previous one.
  if (sandbox) {
    const old = await StandDayModel.find({ eventId, sandbox: true }, { _id: 1 }).lean().exec();
    await StandDayModel.deleteMany({ eventId, sandbox: true }).exec();
    await StandEntryModel.deleteMany({ dayId: { $in: old.map((d) => d._id) } }).exec();
  }
  const floatHuf = emptyCount(input.floatHuf) ? 0 : money(input.floatHuf, "The opening float");
  return StandDayModel.create({ organizationId, eventId, date, devices: Boolean(input.devices), sandbox, floatHuf, lines, status: "open" });
}

/** Ends the practice run: it is deleted, leaving no trace in stats or inventory. */
export async function endSandbox(organizationId: string, dayId: string): Promise<void> {
  const result = await StandDayModel.deleteOne({ _id: dayId, organizationId, sandbox: true }).exec();
  if (result.deletedCount === 0) throw ActionError.notFound("Practice day not found");
  await StandEntryModel.deleteMany({ dayId }).exec();
}

type Counter = StandCounter;

interface Actor {
  /** Who did it (shown in the log). */
  by?: string;
  /** The entry this change reverses (a storno made from the log). */
  reverses?: Types.ObjectId;
}

async function logEntry(day: IStandDay, productId: string, field: IStandEntry["field"], quantity: number, actor: Actor, previous: number | null = null): Promise<void> {
  const line = day.lines.find((l) => String(l.productId) === productId);
  try {
    await StandEntryModel.create({
      organizationId: day.organizationId,
      eventId: day.eventId,
      dayId: day._id,
      productId,
      productName: line?.name ?? "",
      field,
      quantity,
      previous,
      priceHuf: line?.priceHuf ?? 0,
      depositHuf: line?.depositHuf ?? 0,
      storno: quantity < 0 && field !== "opening",
      reverses: actor.reverses ?? null,
      by: actor.by ?? "",
    });
  } catch (error) {
    // The counters are the truth and already changed; a missing log line mustn't fail the sale.
    console.error("[stand log]", error);
  }
}

async function adjust(organizationId: string, dayId: string, productId: string, field: Counter, delta: number, actor: Actor = {}): Promise<IStandDay> {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) throw ActionError.validation("Invalid amount.");
  const day = await StandDayModel.findOneAndUpdate(
    // Atomic and guarded: the counter can't go below zero, and only an open day changes.
    // (Only a subtraction needs the floor; a line saved before a counter existed has no such field yet.)
    { _id: dayId, organizationId, status: "open", lines: { $elemMatch: { productId: oid(productId), ...(delta < 0 ? { [field]: { $gte: -delta } } : {}) } } },
    { $inc: { [`lines.$.${field}`]: delta } },
    { returnDocument: "after" },
  ).exec();
  if (day) {
    await logEntry(day, productId, field, delta, actor);
    return day;
  }
  const existing = await StandDayModel.findOne({ _id: dayId, organizationId }).exec();
  if (!existing) throw ActionError.notFound("Day not found");
  if (existing.status !== "open") throw ActionError.validation("This day is closed.");
  throw ActionError.validation("Nothing to undo.");
}

/** One or more units sold. `method` decides which drawer the money belongs to. */
export function sell(organizationId: string, dayId: string, productId: string, method: "cash" | "card", quantity = 1, by?: string): Promise<IStandDay> {
  return adjust(organizationId, dayId, productId, method === "card" ? "soldCard" : "soldCash", quantity, { by });
}
export const undoSale = (organizationId: string, dayId: string, productId: string, method: "cash" | "card", by?: string) => sell(organizationId, dayId, productId, method, -1, by);
/** Stock brought to the stand while selling (negative = correction). */
export const restock = (organizationId: string, dayId: string, productId: string, quantity: number, by?: string) => adjust(organizationId, dayId, productId, "restocked", quantity, { by });
/** Belső fogyasztás. `outside`: consumed outside the stand, so the stand's stock stays as it is. */
export const recordInternal = (organizationId: string, dayId: string, productId: string, quantity: number, outside = false, by?: string) =>
  adjust(organizationId, dayId, productId, outside ? "internalOutside" : "internal", quantity, { by });

/**
 * Storno of one logged entry: reverses exactly what it did, once. The entry
 * is marked first (so two people can't reverse it twice); if the change
 * can't be made (e.g. something already took it back) the mark is undone.
 */
export async function stornoEntry(organizationId: string, entryId: string, by?: string): Promise<IStandDay> {
  const entry = await StandEntryModel.findOneAndUpdate(
    { _id: entryId, organizationId, stornoed: { $ne: true }, quantity: { $gt: 0 }, field: { $ne: "opening" } },
    { $set: { stornoed: true } },
    { returnDocument: "before" },
  ).exec();
  if (!entry) {
    const existing = await StandEntryModel.findOne({ _id: entryId, organizationId }).exec();
    if (!existing) throw ActionError.notFound("Entry not found");
    throw ActionError.validation(existing.stornoed ? "This entry was already reversed." : "This entry can't be reversed.");
  }
  try {
    return await adjust(organizationId, String(entry.dayId), String(entry.productId), entry.field as Counter, -entry.quantity, { by, reverses: entry._id as Types.ObjectId });
  } catch (error) {
    await StandEntryModel.updateOne({ _id: entryId }, { $set: { stornoed: false } }).exec();
    throw error;
  }
}

/**
 * Storno of some units of one product, straight from its counter — no log
 * entry needed, so it also works on a day that was opened before the log
 * existed. It is logged as a storno.
 */
export function stornoLine(organizationId: string, dayId: string, productId: string, field: Counter, quantity: number, by?: string): Promise<IStandDay> {
  if (!Number.isInteger(quantity) || quantity <= 0) throw ActionError.validation("Invalid amount.");
  return adjust(organizationId, dayId, productId, field, -quantity, { by });
}

export async function listEntries(organizationId: string, dayId: string, limit = 500): Promise<IStandEntry[]> {
  return StandEntryModel.find({ organizationId, dayId }).sort({ at: -1, _id: -1 }).limit(limit).exec();
}

/** Adds a product created after the day opened (with the count it started with). */
export async function addProductToDay(organizationId: string, dayId: string, productId: string, opening = 0): Promise<IStandDay> {
  const day = await StandDayModel.findOne({ _id: dayId, organizationId, status: "open" }).exec();
  if (!day) throw ActionError.notFound("Open day not found");
  if (day.lines.some((l) => String(l.productId) === productId)) return day;
  const product = await StandProductModel.findOne({ _id: productId, eventId: day.eventId }).exec();
  if (!product) throw ActionError.notFound("Product not found");
  day.lines.push(snapshot(product, count(opening)));
  await day.save();
  return day;
}

/** Fixes the opening count of an open day (e.g. differs from last night's closing). */
export async function setOpening(organizationId: string, dayId: string, productId: string, opening: number, by?: string): Promise<IStandDay> {
  const before = await StandDayModel.findOne({ _id: dayId, organizationId, status: "open" }).exec();
  const previous = before?.lines.find((l) => String(l.productId) === productId)?.opening ?? null;
  const day = await StandDayModel.findOneAndUpdate(
    { _id: dayId, organizationId, status: "open", "lines.productId": oid(productId) },
    { $set: { "lines.$.opening": count(opening) } },
    { returnDocument: "after" },
  ).exec();
  if (!day) throw ActionError.notFound("Open day not found");
  await logEntry(day, productId, "opening", count(opening), { by }, previous);
  return day;
}

/** Sets or fixes the opening float of an open day (e.g. it wasn't given when the day was opened). */
export async function setFloat(organizationId: string, dayId: string, floatHuf: number): Promise<IStandDay> {
  const value = money(floatHuf, "The opening float");
  const day = await StandDayModel.findOneAndUpdate({ _id: dayId, organizationId, status: "open" }, { $set: { floatHuf: value } }, { returnDocument: "after" }).exec();
  if (day) return day;
  const existing = await StandDayModel.findOne({ _id: dayId, organizationId }).exec();
  if (!existing) throw ActionError.notFound("Day not found");
  throw ActionError.validation("This day is closed.");
}

export async function setDayDevices(organizationId: string, dayId: string, devices: boolean): Promise<void> {
  await StandDayModel.updateOne({ _id: dayId, organizationId, status: "open" }, { $set: { devices } }).exec();
}

export function toDomain(line: IStandLine): StandLine {
  return {
    productId: String(line.productId),
    name: line.name,
    category: line.category,
    priceHuf: line.priceHuf,
    depositHuf: line.depositHuf,
    costHuf: line.costHuf ?? null,
    opening: line.opening,
    restocked: line.restocked,
    soldCash: line.soldCash,
    soldCard: line.soldCard,
    internal: line.internal,
    internalOutside: line.internalOutside ?? 0,
    counted: line.counted ?? null,
  };
}

export const dayToDomain = (day: IStandDay): StandDayData => ({ date: day.date, floatHuf: day.floatHuf ?? 0, cashActualHuf: day.cashActualHuf ?? null, manual: day.manual ? { cashHuf: day.manual.cashHuf, cardHuf: day.manual.cardHuf } : null, lines: day.lines.map(toDomain) });

export interface CloseInput {
  /** productId → counted closing stock. Missing = trust the calculation. */
  counted?: Record<string, number>;
  /** productId → internal use to record now (replaces the day's counts): from the stand's stock / outside it. */
  internal?: Record<string, { inside?: number; outside?: number }>;
  /** Cash counted in the drawer; the card part of the day's revenue is then the rest. Empty = keep the payment modes as tapped. */
  cashHuf?: number | null;
  /** Correct the opening float while closing. Empty = unchanged. */
  floatHuf?: number | null;
  note?: string;
  /** Send the report here; empty = don't send. */
  emailTo?: string;
  /** Who is closing (shown in the log). */
  by?: string;
}

export async function closeDay(organizationId: string, dayId: string, input: CloseInput, transporter?: MailTransporter): Promise<{ day: IStandDay; emailed: boolean; emailError?: string }> {
  const day = await StandDayModel.findOne({ _id: dayId, organizationId }).exec();
  if (!day) throw ActionError.notFound("Day not found");
  if (day.sandbox) throw ActionError.validation("A practice day isn't closed; end it instead.");
  if (day.status !== "open") throw ActionError.validation("This day is already closed.");
  const lines = (day.toObject() as { lines: IStandLine[] }).lines.map((line) => {
    const id = String(line.productId);
    const given = input.counted?.[id];
    const used = input.internal?.[id];
    return {
      ...line,
      counted: emptyCount(given) ? null : count(given),
      // Left empty = keep what was recorded during the day.
      internal: emptyCount(used?.inside) ? line.internal : count(used!.inside),
      internalOutside: emptyCount(used?.outside) ? (line.internalOutside ?? 0) : count(used!.outside),
    };
  });
  const to = String(input.emailTo ?? "").trim();
  if (to && !/^\S+@\S+\.\S+$/.test(to)) throw ActionError.validation("The report email address isn't valid.");
  const revenue = lines.reduce((sum, l) => sum + (l.soldCash + l.soldCard) * l.priceHuf, 0);
  const floatHuf = emptyCount(input.floatHuf) ? (day.floatHuf ?? 0) : money(input.floatHuf, "The opening float");
  const cashActualHuf = input.cashHuf === undefined || input.cashHuf === null ? null : money(input.cashHuf, "The counted cash");
  // The count is the whole register, float included, so it can't exceed float + the day's revenue.
  if (cashActualHuf !== null && cashActualHuf > floatHuf + revenue) {
    throw ActionError.validation(`The counted cash (${cashActualHuf} Ft) is more than the float (${floatHuf} Ft) plus the day's revenue (${revenue} Ft).`);
  }
  // Closed atomically: two people pressing Close can't both win.
  const closed = await StandDayModel.findOneAndUpdate(
    { _id: dayId, organizationId, status: "open" },
    { $set: { status: "closed", closedAt: new Date(), note: String(input.note ?? "").slice(0, 1000), lines, cashActualHuf, floatHuf } },
    { returnDocument: "after" },
  ).exec();
  if (!closed) throw ActionError.validation("This day is already closed.");
  // Internal use corrected while closing is part of the day's story too.
  const doc = day.toObject() as { lines: IStandLine[] };
  for (const line of closed.lines) {
    const old = doc.lines.find((l) => String(l.productId) === String(line.productId));
    for (const field of ["internal", "internalOutside"] as const) {
      const delta = (line[field] ?? 0) - (old?.[field] ?? 0);
      if (delta !== 0) await logEntry(closed, String(line.productId), field, delta, { by: input.by });
    }
  }
  if (!to) return { day: closed, emailed: false };
  try {
    await sendDayReport(closed, to, transporter);
    return { day: closed, emailed: true };
  } catch (error) {
    // The day is closed either way; the report can be re-sent.
    return { day: closed, emailed: false, emailError: error instanceof Error ? error.message : "The email couldn't be sent." };
  }
}

/**
 * Records a day that wasn't kept in the app: the closing stock per product
 * and the cash/card takings, so the next day can open from it.
 */
export async function recordManualDay(
  organizationId: string,
  eventId: string,
  input: {
    date: string;
    closing: Record<string, number>;
    /** productId → internal use that day: from the stand's stock / outside it. */
    internal?: Record<string, { inside?: number; outside?: number }>;
    cashHuf: number;
    cardHuf: number;
    note?: string;
    /** Email the report (with the Excel) here; empty = don't. */
    emailTo?: string;
  },
  transporter?: MailTransporter,
): Promise<{ day: IStandDay; emailed: boolean; emailError?: string }> {
  await standEventForOrg(organizationId, eventId);
  if (!DATE.test(input.date)) throw ActionError.validation("Invalid date.");
  if (await StandDayModel.exists({ eventId, date: input.date })) throw ActionError.validation("This day already exists.");
  const to = String(input.emailTo ?? "").trim();
  if (to && !/^\S+@\S+\.\S+$/.test(to)) throw ActionError.validation("The report email address isn't valid.");
  const products = await listProducts(eventId, { activeOnly: true });
  const lines = products.map((p) => {
    const id = String(p._id);
    const used = input.internal?.[id];
    return {
      ...snapshot(p, 0),
      counted: emptyCount(input.closing[id]) ? 0 : count(input.closing[id]),
      internal: emptyCount(used?.inside) ? 0 : count(used!.inside),
      internalOutside: emptyCount(used?.outside) ? 0 : count(used!.outside),
    };
  });
  const day = await StandDayModel.create({
    organizationId,
    eventId,
    date: input.date,
    status: "closed",
    manual: { cashHuf: money(input.cashHuf, "The cash revenue"), cardHuf: money(input.cardHuf, "The card revenue") },
    lines,
    note: String(input.note ?? "").slice(0, 1000),
    closedAt: new Date(),
  });
  if (!to) return { day, emailed: false };
  try {
    await sendDayReport(day, to, transporter);
    return { day, emailed: true };
  } catch (error) {
    // The day is saved either way; the report can be re-sent from the stats page.
    return { day, emailed: false, emailError: error instanceof Error ? error.message : "The email couldn't be sent." };
  }
}

/** Re-fixes a closed day's closing counts (the next day's opening isn't rewritten). */
export async function reopenDay(organizationId: string, dayId: string): Promise<void> {
  const day = await StandDayModel.findOne({ _id: dayId, organizationId }).exec();
  if (!day) throw ActionError.notFound("Day not found");
  if (day.sandbox) throw ActionError.validation("A practice day can't be reopened.");
  if (day.status === "open") return;
  if (day.manual) throw ActionError.validation("A day recorded by hand can't be reopened.");
  if (await StandDayModel.exists({ eventId: day.eventId, ...REAL, date: { $gt: day.date } })) throw ActionError.validation("Only the latest day can be reopened.");
  if (await StandDayModel.exists({ eventId: day.eventId, ...REAL, status: "open" })) throw ActionError.validation("Close the day that is open first.");
  await StandDayModel.updateOne({ _id: dayId }, { $set: { status: "open", closedAt: null } }).exec();
}

// ---- Stats ---------------------------------------------------------------------------

export async function standStats(eventId: string, from?: string, to?: string): Promise<{ summary: StandSummary; days: IStandDay[] }> {
  const filter: Record<string, unknown> = { eventId, ...REAL };
  const range: Record<string, string> = {};
  if (from && DATE.test(from)) range.$gte = from;
  if (to && DATE.test(to)) range.$lte = to;
  if (Object.keys(range).length) filter.date = range;
  // Open days are included: their numbers are live.
  const days = await StandDayModel.find(filter).sort({ date: 1 }).exec();
  return { summary: summarizeStand(days.map(dayToDomain)), days };
}

// ---- Internal cash (the safe) --------------------------------------------------------

/** Takes cash out of the internal cash, with the reason. Separate from the register the cash report is about. */
export async function addWithdrawal(organizationId: string, eventId: string, input: { amountHuf: number; note: string; date?: string }, by?: string): Promise<IStandWithdrawal> {
  await standEventForOrg(organizationId, eventId);
  const amountHuf = money(input.amountHuf, "The amount");
  if (amountHuf < 1) throw ActionError.validation("The amount must be more than 0.");
  const note = String(input.note ?? "").trim().slice(0, 500);
  if (!note) throw ActionError.validation("Write why the money was taken out.");
  const date = input.date && DATE.test(input.date) ? input.date : todayKey();
  return StandWithdrawalModel.create({ organizationId, eventId, date, amountHuf, note, by: by ?? "" });
}

/** Reverses a withdrawal (a wrong amount, say) once; the line stays, marked. */
export async function stornoWithdrawal(organizationId: string, withdrawalId: string, by?: string): Promise<void> {
  const done = await StandWithdrawalModel.findOneAndUpdate({ _id: withdrawalId, organizationId, stornoed: { $ne: true } }, { $set: { stornoed: true, stornoedBy: by ?? "" } }).exec();
  if (done) return;
  const existing = await StandWithdrawalModel.findOne({ _id: withdrawalId, organizationId }).exec();
  if (!existing) throw ActionError.notFound("Withdrawal not found");
  throw ActionError.validation("This withdrawal was already reversed.");
}

export function listWithdrawals(eventId: string, from?: string, to?: string): Promise<IStandWithdrawal[]> {
  const filter: Record<string, unknown> = { eventId };
  const range: Record<string, string> = {};
  if (from && DATE.test(from)) range.$gte = from;
  if (to && DATE.test(to)) range.$lte = to;
  if (Object.keys(range).length) filter.date = range;
  return StandWithdrawalModel.find(filter).sort({ at: -1 }).limit(500).exec();
}

// ---- Reports -------------------------------------------------------------------------

const ft = (n: number) => `${Math.round(n).toLocaleString("hu-HU")} Ft`;

export async function buildReportXlsx(days: IStandDay[], title: string): Promise<Buffer> {
  const data = days.map(dayToDomain);
  const summary = summarizeStand(data);
  const workbook = new ExcelJS.Workbook();

  const overview = workbook.addWorksheet("Összesítő");
  overview.columns = [
    { header: title, key: "k", width: 40 },
    { header: "", key: "v", width: 20 },
  ];
  overview.getRow(1).font = { bold: true };
  const counted = summary.byDay.some((d) => d.cashCounted);
  const rows: Array<[string, number | string]> = [
    ["Napok száma", summary.days],
    ["NAPI BEVÉTEL (összesen, visszaváltási díjjal)", summary.revenue],
    // The cash report: the register holds the float plus the cash sales. Item prices already contain the deposit, so
    // these are gross totals — whole hundreds when the prices are. The deposit-free net below deliberately won't match.
    ["Nyitó váltó", summary.floatHuf],
    ["Készpénzes eladás (visszaváltási díjjal)", summary.cash],
    ["KASSZÁBAN VÁRHATÓ KÉSZPÉNZ (váltóval)", summary.cashInRegister],
    ["Kártyás bevétel (visszaváltási díjjal)", summary.card],
    ["KASSZA ÖSSZESEN (készpénz + kártya, váltóval)", summary.registerTotal],
    [counted ? "A készpénz/kártya bontás a megszámolt készpénzből (váltó levonva) számolt" : "A készpénz/kártya bontás a rögzített fizetési módok szerinti", ""],
    ["Ebből visszaváltási díj (nem nyereség)", summary.deposit],
    ["Nettó bevétel (visszaváltási díj nélkül – nem egyezik a kasszával)", summary.netRevenue],
    ["Eladott tételek", summary.itemsSold],
    ["Beszerzési költség", summary.cost],
    ["Nyereség", summary.profitComplete ? summary.profit : `${summary.profit} (nem minden termék beszerzési ára ismert)`],
    ["Belső fogyasztás (db)", summary.internalItems],
    ["Ebből standon kívül (db)", summary.internalOutsideItems],
    ["Belső fogyasztás értéke (eladási áron)", summary.internalValue],
    ["Belső fogyasztás költsége", summary.internalCost],
    ["Nyereség a belső fogyasztás után", summary.profitAfterInternal],
    ["Leltárkülönbség (db)", summary.variance],
    ["Leltárkülönbség értéke", summary.varianceValue],
  ];
  for (const [k, v] of rows) {
    const row = overview.addRow({ k, v });
    if (k.startsWith("NAPI BEVÉTEL") || k.startsWith("KASSZÁBAN") || k.startsWith("KASSZA ÖSSZESEN")) row.font = { bold: true, size: 14 };
  }

  const products = workbook.addWorksheet("Termékek");
  products.columns = [
    { header: "Termék", key: "name", width: 28 },
    { header: "Nyitó", key: "opening", width: 10 },
    { header: "Bevételezés", key: "restocked", width: 12 },
    { header: "Eladott", key: "sold", width: 10 },
    { header: "Készpénz db", key: "cash", width: 12 },
    { header: "Kártya db", key: "card", width: 12 },
    { header: "Belső fogyasztás", key: "internal", width: 16 },
    { header: "Ebből standon kívül", key: "internalOutside", width: 18 },
    { header: "Záró", key: "closing", width: 10 },
    { header: "Bevétel", key: "revenue", width: 14 },
    { header: "Visszaváltási érték", key: "deposit", width: 18 },
    { header: "Beszerzési költség", key: "cost", width: 18 },
    { header: "Nyereség", key: "profit", width: 14 },
    { header: "Belső fogy. értéke", key: "internalValue", width: 18 },
    { header: "Leltárkülönbség", key: "variance", width: 16 },
  ];
  products.getRow(1).font = { bold: true };
  for (const p of summary.byProduct) {
    products.addRow({ name: p.name, opening: p.opening, restocked: p.restocked, sold: p.sold, cash: p.soldCash, card: p.soldCard, internal: p.internal, internalOutside: p.internalOutside, closing: p.closing, revenue: p.revenue, deposit: p.deposit, cost: p.cost ?? "", profit: p.profit ?? "", internalValue: p.internalValue, variance: p.variance });
  }

  const byDay = workbook.addWorksheet("Napok");
  byDay.columns = [
    { header: "Nap", key: "date", width: 12 },
    { header: "Bevétel", key: "revenue", width: 14 },
    { header: "Készpénz", key: "cash", width: 14 },
    { header: "Kártya", key: "card", width: 14 },
    { header: "Nyitó váltó", key: "float", width: 14 },
    { header: "Kassza összesen (váltóval)", key: "register", width: 24 },
    { header: "Visszaváltási érték", key: "deposit", width: 18 },
    { header: "Nyereség", key: "profit", width: 14 },
    { header: "Eladott db", key: "items", width: 12 },
    { header: "Belső fogy. db", key: "internalItems", width: 14 },
    { header: "Ebből standon kívül", key: "internalOutsideItems", width: 18 },
    { header: "Belső fogy. értéke", key: "internalValue", width: 18 },
    { header: "Megjegyzés", key: "note", width: 40 },
  ];
  byDay.getRow(1).font = { bold: true };
  summary.byDay.forEach((row, i) => byDay.addRow({ date: row.date, revenue: row.revenue, cash: row.cash, card: row.card, float: row.floatHuf, register: row.registerTotal, deposit: row.deposit, profit: row.profit ?? "", items: row.itemsSold, internalItems: row.internalItems, internalOutsideItems: row.internalOutsideItems, internalValue: row.internalValue, note: (row.manual ? "Utólag rögzítve. " : "") + (days[i]?.note ?? "") }));

  const entries = await StandEntryModel.find({ dayId: { $in: days.map((d) => d._id) } }).sort({ at: 1 }).lean().exec();
  if (entries.length > 0) {
    const dateOf = new Map(days.map((d) => [String(d._id), d.date]));
    const log = workbook.addWorksheet("Napló");
    log.columns = [
      { header: "Nap", key: "date", width: 12 },
      { header: "Időpont", key: "at", width: 20 },
      { header: "Termék", key: "product", width: 28 },
      { header: "Művelet", key: "what", width: 36 },
      { header: "Mennyiség", key: "qty", width: 12 },
      { header: "Érték (Ft)", key: "value", width: 14 },
      { header: "Ki", key: "by", width: 28 },
      { header: "Állapot", key: "state", width: 16 },
    ];
    log.getRow(1).font = { bold: true };
    for (const e of entries) {
      log.addRow({
        date: dateOf.get(String(e.dayId)) ?? "",
        at: e.at,
        product: e.productName,
        what: `${e.storno ? "STORNO – " : ""}${entryLabel(e.field)}`,
        qty: e.quantity,
        value: e.field === "soldCash" || e.field === "soldCard" || e.field === "internal" || e.field === "internalOutside" ? e.quantity * e.priceHuf : "",
        by: e.by,
        state: e.stornoed ? "stornózva" : e.reverses ? "storno" : "",
      });
    }
  }

  const withdrawals = await withdrawalsBetween(days);
  if (withdrawals.length > 0) {
    const safe = workbook.addWorksheet("Belső kassza kivét");
    safe.columns = [
      { header: "Nap", key: "date", width: 12 },
      { header: "Időpont", key: "at", width: 20 },
      { header: "Összeg (Ft)", key: "amount", width: 14 },
      { header: "Miért", key: "note", width: 50 },
      { header: "Ki", key: "by", width: 28 },
      { header: "Állapot", key: "state", width: 14 },
    ];
    safe.getRow(1).font = { bold: true };
    for (const w of withdrawals) safe.addRow({ date: w.date, at: w.at, amount: w.amountHuf, note: w.note, by: w.by, state: w.stornoed ? "stornózva" : "" });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** The internal-cash withdrawals of the event, from the first to the last of these days. */
async function withdrawalsBetween(days: IStandDay[]): Promise<IStandWithdrawal[]> {
  const real = days.filter((d) => DATE.test(d.date));
  if (real.length === 0) return [];
  const dates = real.map((d) => d.date).sort();
  return StandWithdrawalModel.find({ eventId: real[0]!.eventId, date: { $gte: dates[0]!, $lte: dates.at(-1)! } }).sort({ at: 1 }).exec();
}

const ENTRY_LABELS: Record<string, string> = {
  soldCash: "Eladás (készpénz)",
  soldCard: "Eladás (kártya)",
  internal: "Belső fogyasztás (standból)",
  internalOutside: "Belső fogyasztás (standon kívül)",
  restocked: "Bevételezés",
  opening: "Nyitókészlet módosítása",
};
export const entryLabel = (field: string): string => ENTRY_LABELS[field] ?? field;

export function reportHtml(event: IEvent, day: IStandDay): string {
  const s = summarizeStand([dayToDomain(day)]);
  const row = (label: string, value: string) => `<tr><td style="padding:2px 12px 2px 0">${escapeHtml(label)}</td><td style="text-align:right"><b>${escapeHtml(value)}</b></td></tr>`;
  const items = s.byProduct
    .filter((p) => p.sold > 0 || p.internal > 0)
    .map((p) => `<li>${escapeHtml(p.name)}: ${p.sold} db eladva${p.internal ? `, ${p.internal} db belső fogyasztás${p.internalOutside ? ` (ebből ${p.internalOutside} standon kívül)` : ""}` : ""}</li>`)
    .join("");
  const counted = s.byDay[0]?.cashCounted;
  return `<p>${escapeHtml(event.name)} — ${escapeHtml(day.date)} záró jelentés. A részletes kimutatás a csatolt Excelben.</p>
<p style="font-size:22px;margin:12px 0 2px">Napi bevétel: <b>${escapeHtml(ft(s.revenue))}</b></p>
<p style="margin:0 0 8px;color:#52525b">A visszaváltási díjat tartalmazza, így a kassza-riporttal egyezik.</p>
<table>${row("Nyitó váltó", ft(s.floatHuf))}${row("Készpénzes eladás", ft(s.cash))}${row("Kasszában várható készpénz (váltóval)", ft(s.cashInRegister))}${row("Kártyás bevétel", ft(s.card))}${row("Kassza összesen (váltóval)", ft(s.registerTotal))}</table>
<p style="margin:2px 0 8px;color:#52525b;font-size:12px">${counted ? "A bontás a megszámolt készpénzből számolt." : "A bontás a rögzített fizetési módok szerinti."}</p>
<table>${row("Ebből visszaváltási díj", ft(s.deposit))}${row("Nettó bevétel (visszaváltási díj nélkül)", ft(s.netRevenue))}${row("Belső fogyasztás értéke", ft(s.internalValue))}${s.profitComplete ? row("Nyereség", ft(s.profit)) : ""}</table>
<ul>${items}</ul>${day.note ? `<p>${escapeHtml(day.note)}</p>` : ""}`;
}

export async function sendDayReport(day: IStandDay, to: string, transporter?: MailTransporter): Promise<void> {
  if (!/^\S+@\S+\.\S+$/.test(to)) throw ActionError.validation("The report email address isn't valid.");
  if (day.sandbox) throw ActionError.validation("A practice day has no report.");
  const event = await eventRepository.findById(String(day.eventId));
  if (!event) throw ActionError.notFound("Event not found");
  const buffer = await buildReportXlsx([day], `${event.name} — ${day.date}`);
  await sendMail(
    String(day.organizationId),
    {
      to,
      subject: `${event.name} – záró jelentés ${day.date}`,
      html: reportHtml(event, day),
      attachments: [{ filename: `stand-${day.date}.xlsx`, content: buffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
    },
    transporter ?? moduleMailTransporter(),
  );
  await StandDayModel.updateOne({ _id: day._id }, { $set: { reportSentTo: to } }).exec();
}

export async function exportStandXlsx(organizationId: string, eventId: string, from?: string, to?: string): Promise<{ fileName: string; buffer: Buffer }> {
  const event = await standEventForOrg(organizationId, eventId);
  const { days } = await standStats(eventId, from, to);
  const safe = event.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "stand";
  return { fileName: `${safe}-stand.xlsx`, buffer: await buildReportXlsx(days, event.name) };
}

export { expectedClosing, lineTotals };
