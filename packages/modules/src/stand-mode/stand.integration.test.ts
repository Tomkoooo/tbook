import { MongoMemoryServer } from "mongodb-memory-server";
import { EventGroupModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../index";
import { StandDayModel } from "./model";
import { adjustStock, setDayTakings, reportHtml, setFloat, addWithdrawal, listWithdrawals, stornoWithdrawal, listEntries, stornoEntry, stornoLine, endSandbox, getOpenDay, getSandboxDay, closeDay, getDay, openDay, proposeOpening, recordInternal, recordManualDay, restock, saveProduct, sell, setOpening, standStats, undoSale, buildReportXlsx } from "./service";

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
    await expect(closeDay(org, String(d._id), { cashHuf: 5000 })).rejects.toThrow(/plus the tapped sales/);
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

  it("keeps the opening float out of revenue and in the register total", async () => {
    const stillOpen = await getOpenDay(event);
    if (stillOpen) await closeDay(org, String(stillOpen._id), {});
    const d = await openDay(org, event, { date: "2026-09-10", floatHuf: 20000, openings: { [cola]: 30 } });
    expect(d.floatHuf).toBe(20000);
    await sell(org, String(d._id), cola, "cash", 5);
    await sell(org, String(d._id), cola, "card", 5);
    await expect(closeDay(org, String(d._id), { cashHuf: 99999 })).rejects.toThrow(/float/);
    await closeDay(org, String(d._id), {});
    const s = (await standStats(event, "2026-09-10", "2026-09-10")).summary;
    expect(s).toMatchObject({ revenue: 6000, cash: 3000, card: 3000, floatHuf: 20000, cashInRegister: 23000, registerTotal: 26000 });
    // Tomorrow's float starts from this one.
    expect((await proposeOpening(event, "2026-09-11")).floatHuf).toBe(20000);
  });

  it("lets the float be set or fixed later on a day that was already opened", async () => {
    const d = await openDay(org, event, { date: "2026-09-12", openings: { [cola]: 10 } });
    expect(d.floatHuf).toBe(0);
    const fixed = await setFloat(org, String(d._id), 15000);
    expect(fixed.floatHuf).toBe(15000);
    await expect(setFloat(org, String(d._id), -1)).rejects.toThrow(/forints/);
    await closeDay(org, String(d._id), {});
    await expect(setFloat(org, String(d._id), 1)).rejects.toThrow(/closed/);
  });

  it("records internal-cash (safe) withdrawals with a reason, apart from the register", async () => {
    await expect(addWithdrawal(org, event, { amountHuf: 5000, note: "  " })).rejects.toThrow(/why/);
    await expect(addWithdrawal(org, event, { amountHuf: 0, note: "x" })).rejects.toThrow(/more than 0/);
    const w = await addWithdrawal(org, event, { amountHuf: 50000, note: "Beszerzés a nagykerből", date: "2026-09-10" }, "boss@example.com");
    expect(w).toMatchObject({ amountHuf: 50000, by: "boss@example.com", stornoed: false });
    const before = (await standStats(event, "2026-09-10", "2026-09-10")).summary;
    expect(before.registerTotal).toBe(26000); // the register report is untouched

    await stornoWithdrawal(org, String(w._id), "boss@example.com");
    await expect(stornoWithdrawal(org, String(w._id))).rejects.toThrow(/already reversed/);
    expect((await listWithdrawals(event, "2026-09-10", "2026-09-10"))[0]!.stornoed).toBe(true);
    const days = (await standStats(event, "2026-09-10", "2026-09-10")).days;
    expect((await buildReportXlsx(days, "t")).length).toBeGreaterThan(1000);
  });

  it("keeps a day by stock adjustments + closing count and enters the takings as totals", async () => {
    const stillOpen = await getOpenDay(event);
    if (stillOpen) await closeDay(org, String(stillOpen._id), {});
    const d = await openDay(org, event, { date: "2026-10-01", floatHuf: 20000, openings: { [cola]: 30, [lagos]: 10 } });
    const id = String(d._id);
    // Not every sale is tapped: only the changes to the inventory are noted.
    const adjusted = await adjustStock(org, id, cola, 4, "törött üveg", "boss@example.com");
    expect(adjusted.lines.find((l) => String(l.productId) === cola)!.adjusted).toBe(4);
    await expect(adjustStock(org, id, cola, 0)).rejects.toThrow(/1 or more/);
    await expect(adjustStock(org, id, cola, -2)).rejects.toThrow(/1 or more/);
    // A plain adjustment, not a storno, and it carries its reason.
    const entries = await listEntries(org, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ field: "adjusted", quantity: 4, storno: false, reason: "törött üveg", by: "boss@example.com" });
    // It can still be taken back from the log, once.
    await stornoEntry(org, String(entries[0]!._id));
    expect((await getDay(event, "2026-10-01"))!.lines.find((l) => String(l.productId) === cola)!.adjusted).toBe(0);
    await adjustStock(org, id, cola, 4, "törött üveg");

    // Cash (with the float) above anything tapped is fine when the takings are entered as totals.
    await expect(closeDay(org, id, { cashHuf: 150000, counted: { [cola]: 20 } })).rejects.toThrow(/card takings/);
    await expect(closeDay(org, id, { cashHuf: 1000, cardHuf: 5000 })).rejects.toThrow(/less than the float/);
    await expect(closeDay(org, id, { cardHuf: 5000 })).rejects.toThrow(/counted cash/);
    const closed = await closeDay(org, id, { cashHuf: 150000, cardHuf: 45000, counted: { [cola]: 20, [lagos]: 3 }, note: "bevétel: kp 130000, bk 45000", emailTo: "boss@example.com" }, transporter as never);
    expect(closed.day.takings).toMatchObject({ cashHuf: 130000, cardHuf: 45000 });
    expect(closed.emailed).toBe(true);

    const s = (await standStats(event, "2026-10-01", "2026-10-01")).summary;
    expect(s).toMatchObject({ revenue: 175000, cash: 130000, card: 45000, floatHuf: 20000, cashInRegister: 150000, registerTotal: 195000, adjustedItems: 4, variance: 0 });
    expect(s.byProduct.find((p) => p.name === "Cola")).toMatchObject({ opening: 30, adjusted: 4, closing: 20 });
    // Tomorrow opens from the count.
    expect((await proposeOpening(event, "2026-10-02")).items.find((i) => i.productId === cola)!.opening).toBe(20);

    // The report is inventory + takings + note only.
    const html = reportHtml((await EventModel.findById(event))!, closed.day);
    expect(html).toContain("Leltár");
    expect(html).toContain("bevétel: kp 130000, bk 45000");
    expect(html).not.toContain("Nyereség");
    expect(html).not.toContain("visszaváltási");
  });

  it("enters or corrects the takings of a day that is already closed (kp without the float)", async () => {
    const day = await openDay(org, event, { date: "2026-10-02", floatHuf: 10000, openings: { [cola]: 20 } });
    const id = String(day._id);
    await adjustStock(org, id, cola, 2);
    const closed = await closeDay(org, id, { counted: { [cola]: 18 }, note: "kp 80000 (váltó nélkül), bk 20000" });
    expect(closed.day.takings).toBeNull();
    await expect(setDayTakings(org, id, { cashHuf: -1, cardHuf: 0 })).rejects.toThrow(/forints/);
    const fixed = await setDayTakings(org, id, { cashHuf: 80000, cardHuf: 20000 });
    expect(fixed.takings).toMatchObject({ cashHuf: 80000, cardHuf: 20000 });
    expect(fixed.floatHuf).toBe(10000);
    expect(fixed.note).toBe("kp 80000 (váltó nélkül), bk 20000");
    const s = (await standStats(event, "2026-10-02", "2026-10-02")).summary;
    expect(s).toMatchObject({ revenue: 100000, cash: 80000, card: 20000, cashInRegister: 90000, registerTotal: 110000 });
    const days = (await standStats(event, "2026-10-02", "2026-10-02")).days;
    expect((await buildReportXlsx(days, "t")).length).toBeGreaterThan(1000);
    // An open day has nothing to correct yet.
    const open = await openDay(org, event, { date: "2026-10-03", openings: { [cola]: 18 } });
    await expect(setDayTakings(org, String(open._id), { cashHuf: 1, cardHuf: 1 })).rejects.toThrow(/Close the day first/);
    await closeDay(org, String(open._id), {});
  });
});
