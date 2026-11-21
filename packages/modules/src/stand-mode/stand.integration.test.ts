import { MongoMemoryServer } from "mongodb-memory-server";
import { EventGroupModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../index";
import { StandDayModel } from "./model";
import { listEntries, stornoEntry, stornoLine, endSandbox, getOpenDay, getSandboxDay, closeDay, getDay, openDay, proposeOpening, recordInternal, recordManualDay, restock, saveProduct, sell, setOpening, standStats, undoSale, buildReportXlsx } from "./service";

const sent: Array<{ to: string; subject: string; attachments?: Array<{ filename: string }> }> = [];
const transporter = { sendMail: async (m: never) => (sent.push(m), {} as never) };

describe("stand mode", () => {
  let mongod: MongoMemoryServer;
  let org: string;
  let event: string;
  let cola: string;
  let lagos: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await dbConnect(mongod.getUri());
    process.env.EMAIL_HOST = "smtp.test.invalid";
    process.env.EMAIL_USER = "noreply@test.invalid";
    process.env.EMAIL_PASS = "x";
    const o = await OrganizationModel.create({ name: "Org", slug: "org", modules: { "stand-mode": { enabled: true } } });
    org = String(o._id);
    const g = await EventGroupModel.create({ organizationId: org, name: "G", apiKeyHash: "h", apiKeyHint: "h", apiKeyCreatedAt: new Date() });
    const e = await EventModel.create({ groupId: g._id, organizationId: org, name: "Remíz pult", status: "active", startDate: new Date(), endDate: new Date(), ticketFeeHuf: 0, modules: { "stand-mode": { enabled: true } } });
    event = String(e._id);
    cola = String((await saveProduct(org, event, null, { name: "Cola", category: "drink", priceHuf: 600, depositHuf: 50, costHuf: 350 }))._id);
    lagos = String((await saveProduct(org, event, null, { name: "Lángos", category: "food", priceHuf: 1500 }))._id);
  });
  afterAll(async () => {
    await dbDisconnectAll();
    await mongod?.stop();
  });

  it("rejects a deposit above the price", async () => {
    await expect(saveProduct(org, event, null, { name: "X", category: "drink", priceHuf: 40, depositHuf: 50 })).rejects.toThrow(/part of the price/);
  });

  it("runs a day, carries the closing stock to the next day and reports", async () => {
    const day = await openDay(org, event, { date: "2026-07-02", openings: { [cola]: 24, [lagos]: 10 } });
    const id = String(day._id);
    await sell(org, id, cola, "cash", 3);
    await sell(org, id, cola, "card");
    await undoSale(org, id, cola, "card");
    await expect(undoSale(org, id, cola, "card")).rejects.toThrow(/Nothing to undo/);
    await restock(org, id, cola, 12);
    await recordInternal(org, id, lagos, 1);
    await sell(org, id, lagos, "card", 2);
    // Consumed outside the stand: internal use, but the stand's stock is untouched.
    await recordInternal(org, id, lagos, 2, true);
    await expect(recordInternal(org, id, lagos, -3, true)).rejects.toThrow(/Nothing to undo/);

    // Internal use is optional: the cola line has none given (kept as recorded), the lángos is corrected.
    const result = await closeDay(org, id, { counted: { [cola]: 32 }, internal: { [lagos]: { inside: 1, outside: 3 }, [cola]: { inside: undefined } }, cashHuf: 2000, emailTo: "boss@example.com" }, transporter as never);
    expect(result.emailed).toBe(true);
    expect(sent[0]).toMatchObject({ to: "boss@example.com" });
    expect(sent[0]!.attachments?.[0]?.filename).toBe("stand-2026-07-02.xlsx");
    await expect(sell(org, id, cola, "cash")).rejects.toThrow(/closed/);

    const next = await proposeOpening(event, "2026-07-03");
    expect(next.previousDate).toBe("2026-07-02");
    expect(next.items.find((i) => i.productId === cola)).toMatchObject({ opening: 32, fromPrevious: true });
    expect(next.items.find((i) => i.productId === lagos)!.opening).toBe(7); // 10 − 2 sold − 1 internal; the 2 outside don't count

    const day2 = await openDay(org, event, { date: "2026-07-03" });
    await setOpening(org, String(day2._id), cola, 30);
    expect((await getDay(event, "2026-07-03"))!.lines.find((l) => String(l.productId) === cola)!.opening).toBe(30);
    await expect(openDay(org, event, { date: "2026-07-04" })).rejects.toThrow(/still open/);

    const { summary, days } = await standStats(event, "2026-07-02", "2026-07-02");
    // Revenue is the sales total; the counted cash (2 000 Ft) fixes the split.
    expect(summary.revenue).toBe(3 * 600 + 2 * 1500);
    expect(summary.cash).toBe(2000);
    expect(summary.card).toBe(3 * 600 + 2 * 1500 - 2000);
    expect(summary.deposit).toBe(150);
    // Internal use was corrected while closing: 1 from the stand, 3 outside it.
    expect(summary.internalItems).toBe(4);
    expect(summary.internalOutsideItems).toBe(3);
    expect(summary.internalValue).toBe(4 * 1500);
    expect(summary.variance).toBe(32 - (24 + 12 - 3));
    expect((await buildReportXlsx(days, "t")).length).toBeGreaterThan(1000);
  });

  it("rejects counted cash above the day's revenue and keeps empty fields from failing", async () => {
    const stillOpen = await getOpenDay(event);
    if (stillOpen) await closeDay(org, String(stillOpen._id), {});
    const d = await openDay(org, event, { date: "2026-08-01", openings: { [cola]: 10, [lagos]: 10 } });
    await sell(org, String(d._id), cola, "cash", 2);
    await expect(closeDay(org, String(d._id), { cashHuf: 5000 })).rejects.toThrow(/more than the day's revenue/);
    const closed = await closeDay(org, String(d._id), { counted: { [cola]: undefined as never }, internal: { [cola]: { inside: "" as never, outside: NaN } } });
    expect(closed.day.status).toBe("closed");
  });

  it("records a day by hand so tomorrow can open from it", async () => {
    const manual = await recordManualDay(
      org,
      event,
      { date: "2026-07-01", closing: { [cola]: 40, [lagos]: 5 }, internal: { [cola]: { inside: 2, outside: 1 } }, cashHuf: 250000, cardHuf: 130000, emailTo: "boss@example.com" },
      transporter as never,
    );
    expect(manual.emailed).toBe(true);
    expect(sent.at(-1)).toMatchObject({ to: "boss@example.com" });
    const proposal = await proposeOpening(event, "2026-07-02");
    expect(proposal.items.find((i) => i.productId === cola)!.opening).toBe(40);
    const { summary } = await standStats(event, "2026-07-01", "2026-07-01");
    expect(summary).toMatchObject({ cash: 250000, card: 130000, manualDays: 1, internalItems: 3, internalOutsideItems: 1, variance: 0 });
  });

  it("practice runs use the products but never reach stats, history or the next opening", async () => {
    const leftOpen = await getOpenDay(event);
    if (leftOpen) await closeDay(org, String(leftOpen._id), {});
    const before = await standStats(event);
    const practice = await openDay(org, event, { sandbox: true, openings: { [cola]: 100, [lagos]: 50 } });
    expect(practice.sandbox).toBe(true);
    await sell(org, String(practice._id), cola, "cash", 40);
    await recordInternal(org, String(practice._id), lagos, 3);
    await expect(closeDay(org, String(practice._id), {})).rejects.toThrow(/practice/);

    // A real day can open next to it, and nothing leaks either way.
    expect(await getOpenDay(event)).toBeNull();
    expect((await getSandboxDay(event))!.lines.find((l) => String(l.productId) === cola)!.soldCash).toBe(40);
    const stats = await standStats(event);
    expect(stats.summary.revenue).toBe(before.summary.revenue);
    expect(stats.days).toHaveLength(before.days.length);
    const real = await openDay(org, event, { date: "2026-07-09" });
    expect(String((await getOpenDay(event))!._id)).toBe(String(real._id));
    await closeDay(org, String(real._id), {});
    expect((await proposeOpening(event, "2026-07-10")).previousDate).toBe("2026-07-09");

    // Starting again replaces the old run; ending it leaves nothing.
    const again = await openDay(org, event, { sandbox: true });
    expect(await getSandboxDay(event)).not.toBeNull();
    await endSandbox(org, String(again._id));
    expect(await getSandboxDay(event)).toBeNull();
  });

  it("logs every change and lets each entry be reversed once", async () => {
    const stillOpen = await getOpenDay(event);
    if (stillOpen) await closeDay(org, String(stillOpen._id), {});
    const d = await openDay(org, event, { date: "2026-09-01", openings: { [cola]: 20, [lagos]: 5 } });
    const id = String(d._id);
    await sell(org, id, cola, "cash", 3, "pultos@example.com");
    await restock(org, id, cola, 12, "pultos@example.com");
    await recordInternal(org, id, lagos, 1, true, "pultos@example.com");
    await setOpening(org, id, lagos, 6, "pultos@example.com");

    const log = await listEntries(org, id);
    expect(log.map((e) => [e.field, e.quantity])).toEqual([["opening", 6], ["internalOutside", 1], ["restocked", 12], ["soldCash", 3]]);
    expect(log[0]).toMatchObject({ previous: 5, by: "pultos@example.com" });

    const sale = log.find((e) => e.field === "soldCash")!;
    const afterStorno = await stornoEntry(org, String(sale._id), "pultos@example.com");
    expect(afterStorno.lines.find((l) => String(l.productId) === cola)!.soldCash).toBe(0);
    await expect(stornoEntry(org, String(sale._id))).rejects.toThrow(/already reversed/);

    const after = await listEntries(org, id);
    expect(after[0]).toMatchObject({ field: "soldCash", quantity: -3, storno: true });
    expect(String(after[0]!.reverses)).toBe(String(sale._id));
    expect(after.find((e) => String(e._id) === String(sale._id))!.stornoed).toBe(true);

    // Something that was already taken back by hand can't be reversed again (and stays reversible later).
    await sell(org, id, cola, "card", 2);
    const cardSale = (await listEntries(org, id)).find((e) => e.field === "soldCard")!;
    await sell(org, id, cola, "card", -2);
    await expect(stornoEntry(org, String(cardSale._id))).rejects.toThrow(/Nothing to undo/);
    expect((await listEntries(org, id)).find((e) => String(e._id) === String(cardSale._id))!.stornoed).toBe(false);
    await closeDay(org, id, {});
    await expect(stornoEntry(org, String(log.find((e) => e.field === "restocked")!._id))).rejects.toThrow(/closed/);
  });

  it("can storno on a day that has counters but no log (opened before the log existed)", async () => {
    const d = await openDay(org, event, { date: "2026-09-02", openings: { [cola]: 20, [lagos]: 5 } });
    const id = String(d._id);
    // What an older version left behind: counters changed, nothing logged.
    await StandDayModel.updateOne({ _id: id }, { $inc: { "lines.$[l].soldCash": 4, "lines.$[l].restocked": 6 } }, { arrayFilters: [{ "l.productId": d.lines[0]!.productId }] });
    expect(await listEntries(org, id)).toHaveLength(0);
    const day = await stornoLine(org, id, String(d.lines[0]!.productId), "soldCash", 1, "pultos@example.com");
    expect(day.lines[0]!.soldCash).toBe(3);
    await expect(stornoLine(org, id, String(d.lines[0]!.productId), "soldCash", 9)).rejects.toThrow(/Nothing to undo/);
    await stornoLine(org, id, String(d.lines[0]!.productId), "restocked", 6);
    expect(await listEntries(org, id)).toHaveLength(2);
    await closeDay(org, id, {});
  });

  it("the cash register total includes the deposit: gross, whole hundreds, unlike the deposit-free net", async () => {
    // 3 cola at 600 incl. 50 deposit: revenue stays in hundreds, the net ends in 50.
    const probe = await openDay(org, event, { date: "2026-09-03", openings: { [cola]: 30 } });
    await sell(org, String(probe._id), cola, "cash", 3);
    await closeDay(org, String(probe._id), {});
    const day = (await standStats(event, "2026-09-03", "2026-09-03")).summary;
    expect(day.cash).toBe(1800);
    expect(day.cash % 100).toBe(0);
    expect(day.netRevenue).toBe(1650);
    expect(day.netRevenue % 100).toBe(50);
  });
});
