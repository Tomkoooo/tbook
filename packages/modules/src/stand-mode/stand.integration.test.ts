import { MongoMemoryServer } from "mongodb-memory-server";
import { EventGroupModel, EventModel, OrganizationModel, dbConnect, dbDisconnectAll } from "@tbook/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../index";
import { closeDay, getDay, openDay, proposeOpening, recordInternal, recordManualDay, restock, saveProduct, sell, setOpening, standStats, undoSale, buildReportXlsx } from "./service";

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

    const result = await closeDay(org, id, { counted: { [cola]: 32 }, emailTo: "boss@example.com" }, transporter as never);
    expect(result.emailed).toBe(true);
    expect(sent[0]).toMatchObject({ to: "boss@example.com" });
    expect(sent[0]!.attachments?.[0]?.filename).toBe("stand-2026-07-02.xlsx");
    await expect(sell(org, id, cola, "cash")).rejects.toThrow(/closed/);

    const next = await proposeOpening(event, "2026-07-03");
    expect(next.previousDate).toBe("2026-07-02");
    expect(next.items.find((i) => i.productId === cola)).toMatchObject({ opening: 32, fromPrevious: true });
    expect(next.items.find((i) => i.productId === lagos)!.opening).toBe(7);

    const day2 = await openDay(org, event, { date: "2026-07-03" });
    await setOpening(org, String(day2._id), cola, 30);
    expect((await getDay(event, "2026-07-03"))!.lines.find((l) => String(l.productId) === cola)!.opening).toBe(30);
    await expect(openDay(org, event, { date: "2026-07-04" })).rejects.toThrow(/still open/);

    const { summary, days } = await standStats(event, "2026-07-02", "2026-07-02");
    expect(summary.cash).toBe(3 * 600);
    expect(summary.card).toBe(2 * 1500);
    expect(summary.deposit).toBe(150);
    expect(summary.internalValue).toBe(1500);
    expect(summary.variance).toBe(32 - (24 + 12 - 3));
    expect((await buildReportXlsx(days, "t")).length).toBeGreaterThan(1000);
  });

  it("records a day by hand so tomorrow can open from it", async () => {
    await recordManualDay(org, event, { date: "2026-07-01", closing: { [cola]: 40, [lagos]: 5 }, cashHuf: 80000, cardHuf: 30000 });
    const proposal = await proposeOpening(event, "2026-07-02");
    expect(proposal.items.find((i) => i.productId === cola)!.opening).toBe(40);
    const { summary } = await standStats(event, "2026-07-01", "2026-07-01");
    expect(summary).toMatchObject({ cash: 80000, card: 30000, manualDays: 1 });
  });
});
