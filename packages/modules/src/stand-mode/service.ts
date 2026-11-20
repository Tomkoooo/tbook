import ExcelJS from "exceljs";
import { Types } from "mongoose";
import { ActionError } from "@tbook/actions";
import { eventRepository, type IEvent } from "@tbook/db";
import { closingOf, expectedClosing, lineTotals, summarizeStand, type StandDayData, type StandLine, type StandSummary } from "@tbook/domain";
import { resolveModules, sendMail, type MailTransporter } from "@tbook/services";
import { escapeHtml, moduleMailTransporter } from "../shared/mail";
import { StandDayModel, StandProductModel, type IStandDay, type IStandLine, type IStandProduct } from "./model";

export const STAND_MODE = "stand-mode";
export const DEFAULT_PACKS = [6, 10, 12, 20];

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
  const used = await StandDayModel.exists({ eventId, "lines.productId": productId });
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
  return StandDayModel.findOne({ eventId, status: "open" }).sort({ date: -1 }).exec();
}

export function listDays(eventId: string, limit = 60): Promise<IStandDay[]> {
  return StandDayModel.find({ eventId }).sort({ date: -1 }).limit(limit).exec();
}

/** The latest closed day before `date`: where today's opening inventory comes from. */
export function previousClosedDay(eventId: string, date: string): Promise<IStandDay | null> {
  return StandDayModel.findOne({ eventId, status: "closed", date: { $lt: date } }).sort({ date: -1 }).exec();
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
export async function proposeOpening(eventId: string, date: string): Promise<{ previousDate: string | null; items: OpeningProposal[] }> {
  const [products, previous] = await Promise.all([listProducts(eventId, { activeOnly: true }), previousClosedDay(eventId, date)]);
  const closing = new Map<string, number>();
  for (const line of previous?.lines ?? []) closing.set(String(line.productId), Math.max(0, closingOf(toDomain(line))));
  return {
    previousDate: previous?.date ?? null,
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
    counted: null,
  };
}

const count = (v: unknown) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw ActionError.validation("Counts must be whole numbers, 0 or more.");
  return n;
};

export async function openDay(
  organizationId: string,
  eventId: string,
  input: { date?: string; devices?: boolean; openings?: Record<string, number> },
): Promise<IStandDay> {
  await standEventForOrg(organizationId, eventId);
  const date = input.date ?? todayKey();
  if (!DATE.test(date)) throw ActionError.validation("Invalid date.");
  if (await StandDayModel.exists({ eventId, date })) throw ActionError.validation("This day already exists.");
  if (await StandDayModel.exists({ eventId, status: "open" })) throw ActionError.validation("Close the day that is still open first.");
  const proposal = await proposeOpening(eventId, date);
  const products = await listProducts(eventId, { activeOnly: true });
  if (products.length === 0) throw ActionError.validation("Add products first.");
  const lines = products.map((p) => {
    const given = input.openings?.[String(p._id)];
    const fallback = proposal.items.find((i) => i.productId === String(p._id))?.opening ?? 0;
    return snapshot(p, given === undefined ? fallback : count(given));
  });
  return StandDayModel.create({ organizationId, eventId, date, devices: Boolean(input.devices), lines, status: "open" });
}

type Counter = "restocked" | "soldCash" | "soldCard" | "internal";

async function adjust(organizationId: string, dayId: string, productId: string, field: Counter, delta: number): Promise<IStandDay> {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) throw ActionError.validation("Invalid amount.");
  const day = await StandDayModel.findOneAndUpdate(
    // Atomic and guarded: the counter can't go below zero, and only an open day changes.
    { _id: dayId, organizationId, status: "open", lines: { $elemMatch: { productId: oid(productId), [field]: { $gte: delta < 0 ? -delta : 0 } } } },
    { $inc: { [`lines.$.${field}`]: delta } },
    { returnDocument: "after" },
  ).exec();
  if (day) return day;
  const existing = await StandDayModel.findOne({ _id: dayId, organizationId }).exec();
  if (!existing) throw ActionError.notFound("Day not found");
  if (existing.status !== "open") throw ActionError.validation("This day is closed.");
  throw ActionError.validation("Nothing to undo.");
}

/** One or more units sold. `method` decides which drawer the money belongs to. */
export function sell(organizationId: string, dayId: string, productId: string, method: "cash" | "card", quantity = 1): Promise<IStandDay> {
  return adjust(organizationId, dayId, productId, method === "card" ? "soldCard" : "soldCash", quantity);
}
export const undoSale = (organizationId: string, dayId: string, productId: string, method: "cash" | "card") => sell(organizationId, dayId, productId, method, -1);
/** Stock brought to the stand while selling (negative = correction). */
export const restock = (organizationId: string, dayId: string, productId: string, quantity: number) => adjust(organizationId, dayId, productId, "restocked", quantity);
/** Belső fogyasztás. */
export const recordInternal = (organizationId: string, dayId: string, productId: string, quantity: number) => adjust(organizationId, dayId, productId, "internal", quantity);

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
export async function setOpening(organizationId: string, dayId: string, productId: string, opening: number): Promise<IStandDay> {
  const day = await StandDayModel.findOneAndUpdate(
    { _id: dayId, organizationId, status: "open", "lines.productId": oid(productId) },
    { $set: { "lines.$.opening": count(opening) } },
    { returnDocument: "after" },
  ).exec();
  if (!day) throw ActionError.notFound("Open day not found");
  return day;
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
    counted: line.counted ?? null,
  };
}

export const dayToDomain = (day: IStandDay): StandDayData => ({ date: day.date, manual: day.manual ? { cashHuf: day.manual.cashHuf, cardHuf: day.manual.cardHuf } : null, lines: day.lines.map(toDomain) });

export interface CloseInput {
  /** productId → counted closing stock. Missing = trust the calculation. */
  counted?: Record<string, number>;
  note?: string;
  /** Send the report here; empty = don't send. */
  emailTo?: string;
}

export async function closeDay(organizationId: string, dayId: string, input: CloseInput, transporter?: MailTransporter): Promise<{ day: IStandDay; emailed: boolean; emailError?: string }> {
  const day = await StandDayModel.findOne({ _id: dayId, organizationId }).exec();
  if (!day) throw ActionError.notFound("Day not found");
  if (day.status !== "open") throw ActionError.validation("This day is already closed.");
  const lines = (day.toObject() as { lines: IStandLine[] }).lines.map((line) => {
    const given = input.counted?.[String(line.productId)];
    return { ...line, counted: given === undefined || given === null ? null : count(given) };
  });
  const to = String(input.emailTo ?? "").trim();
  if (to && !/^\S+@\S+\.\S+$/.test(to)) throw ActionError.validation("The report email address isn't valid.");
  // Closed atomically: two people pressing Close can't both win.
  const closed = await StandDayModel.findOneAndUpdate(
    { _id: dayId, organizationId, status: "open" },
    { $set: { status: "closed", closedAt: new Date(), note: String(input.note ?? "").slice(0, 1000), lines } },
    { returnDocument: "after" },
  ).exec();
  if (!closed) throw ActionError.validation("This day is already closed.");
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
  input: { date: string; closing: Record<string, number>; cashHuf: number; cardHuf: number; note?: string },
): Promise<IStandDay> {
  await standEventForOrg(organizationId, eventId);
  if (!DATE.test(input.date)) throw ActionError.validation("Invalid date.");
  if (await StandDayModel.exists({ eventId, date: input.date })) throw ActionError.validation("This day already exists.");
  const products = await listProducts(eventId, { activeOnly: true });
  const lines = products.map((p) => ({ ...snapshot(p, 0), counted: count(input.closing[String(p._id)] ?? 0) }));
  return StandDayModel.create({
    organizationId,
    eventId,
    date: input.date,
    status: "closed",
    manual: { cashHuf: count(input.cashHuf), cardHuf: count(input.cardHuf) },
    lines,
    note: String(input.note ?? "").slice(0, 1000),
    closedAt: new Date(),
  });
}

/** Re-fixes a closed day's closing counts (the next day's opening isn't rewritten). */
export async function reopenDay(organizationId: string, dayId: string): Promise<void> {
  const day = await StandDayModel.findOne({ _id: dayId, organizationId }).exec();
  if (!day) throw ActionError.notFound("Day not found");
  if (day.status === "open") return;
  if (day.manual) throw ActionError.validation("A day recorded by hand can't be reopened.");
  if (await StandDayModel.exists({ eventId: day.eventId, date: { $gt: day.date } })) throw ActionError.validation("Only the latest day can be reopened.");
  if (await StandDayModel.exists({ eventId: day.eventId, status: "open" })) throw ActionError.validation("Close the day that is open first.");
  await StandDayModel.updateOne({ _id: dayId }, { $set: { status: "open", closedAt: null } }).exec();
}

// ---- Stats ---------------------------------------------------------------------------

export async function standStats(eventId: string, from?: string, to?: string): Promise<{ summary: StandSummary; days: IStandDay[] }> {
  const filter: Record<string, unknown> = { eventId };
  const range: Record<string, string> = {};
  if (from && DATE.test(from)) range.$gte = from;
  if (to && DATE.test(to)) range.$lte = to;
  if (Object.keys(range).length) filter.date = range;
  // Open days are included: their numbers are live.
  const days = await StandDayModel.find(filter).sort({ date: 1 }).exec();
  return { summary: summarizeStand(days.map(dayToDomain)), days };
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
  const rows: Array<[string, number | string]> = [
    ["Napok száma", summary.days],
    ["Bevétel (összesen)", summary.revenue],
    ["Ebből készpénz", summary.cash],
    ["Ebből kártya", summary.card],
    ["Visszaváltási érték (nem nyereség)", summary.deposit],
    ["Nettó bevétel (visszaváltási érték nélkül)", summary.netRevenue],
    ["Eladott tételek", summary.itemsSold],
    ["Beszerzési költség", summary.cost],
    ["Nyereség", summary.profitComplete ? summary.profit : `${summary.profit} (nem minden termék beszerzési ára ismert)`],
    ["Belső fogyasztás (db)", summary.internalItems],
    ["Belső fogyasztás értéke (eladási áron)", summary.internalValue],
    ["Belső fogyasztás költsége", summary.internalCost],
    ["Nyereség a belső fogyasztás után", summary.profitAfterInternal],
    ["Leltárkülönbség (db)", summary.variance],
    ["Leltárkülönbség értéke", summary.varianceValue],
  ];
  for (const [k, v] of rows) overview.addRow({ k, v });

  const products = workbook.addWorksheet("Termékek");
  products.columns = [
    { header: "Termék", key: "name", width: 28 },
    { header: "Nyitó", key: "opening", width: 10 },
    { header: "Bevételezés", key: "restocked", width: 12 },
    { header: "Eladott", key: "sold", width: 10 },
    { header: "Készpénz db", key: "cash", width: 12 },
    { header: "Kártya db", key: "card", width: 12 },
    { header: "Belső fogyasztás", key: "internal", width: 16 },
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
    products.addRow({ name: p.name, opening: p.opening, restocked: p.restocked, sold: p.sold, cash: p.soldCash, card: p.soldCard, internal: p.internal, closing: p.closing, revenue: p.revenue, deposit: p.deposit, cost: p.cost ?? "", profit: p.profit ?? "", internalValue: p.internalValue, variance: p.variance });
  }

  const byDay = workbook.addWorksheet("Napok");
  byDay.columns = [
    { header: "Nap", key: "date", width: 12 },
    { header: "Bevétel", key: "revenue", width: 14 },
    { header: "Készpénz", key: "cash", width: 14 },
    { header: "Kártya", key: "card", width: 14 },
    { header: "Visszaváltási érték", key: "deposit", width: 18 },
    { header: "Nyereség", key: "profit", width: 14 },
    { header: "Eladott db", key: "items", width: 12 },
    { header: "Belső fogy. db", key: "internalItems", width: 14 },
    { header: "Belső fogy. értéke", key: "internalValue", width: 18 },
    { header: "Megjegyzés", key: "note", width: 40 },
  ];
  byDay.getRow(1).font = { bold: true };
  summary.byDay.forEach((row, i) => byDay.addRow({ date: row.date, revenue: row.revenue, cash: row.cash, card: row.card, deposit: row.deposit, profit: row.profit ?? "", items: row.itemsSold, internalItems: row.internalItems, internalValue: row.internalValue, note: (row.manual ? "Utólag rögzítve. " : "") + (days[i]?.note ?? "") }));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function reportHtml(event: IEvent, day: IStandDay): string {
  const s = summarizeStand([dayToDomain(day)]);
  const row = (label: string, value: string) => `<tr><td style="padding:2px 12px 2px 0">${escapeHtml(label)}</td><td style="text-align:right"><b>${escapeHtml(value)}</b></td></tr>`;
  const items = s.byProduct
    .filter((p) => p.sold > 0 || p.internal > 0)
    .map((p) => `<li>${escapeHtml(p.name)}: ${p.sold} db eladva${p.internal ? `, ${p.internal} db belső fogyasztás` : ""}</li>`)
    .join("");
  return `<p>${escapeHtml(event.name)} — ${escapeHtml(day.date)} záró jelentés. A részletes kimutatás a csatolt Excelben.</p>
<table>${row("Bevétel", ft(s.revenue))}${row("Készpénz", ft(s.cash))}${row("Kártya", ft(s.card))}${row("Visszaváltási érték", ft(s.deposit))}${row("Belső fogyasztás értéke", ft(s.internalValue))}${s.profitComplete ? row("Nyereség", ft(s.profit)) : ""}</table>
<ul>${items}</ul>${day.note ? `<p>${escapeHtml(day.note)}</p>` : ""}`;
}

export async function sendDayReport(day: IStandDay, to: string, transporter?: MailTransporter): Promise<void> {
  if (!/^\S+@\S+\.\S+$/.test(to)) throw ActionError.validation("The report email address isn't valid.");
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
