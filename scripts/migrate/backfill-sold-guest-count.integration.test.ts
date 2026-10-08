import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain-JS migration script, deliberately not part of the TS build (see its header).
import { applyBackfillChanges, computeBackfillChanges } from "./backfill-sold-guest-count.mjs";

/**
 * Guards the one thing that stands between this rebuild and an oversell on
 * a legacy database: `soldGuestCount` is authoritative here but vestigial
 * in the legacy data, so the backfill has to reproduce exactly the status
 * set that `reserveCapacity` treats as holding a seat.
 */
describe("backfill-sold-guest-count", () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db("tbook-admin-test");
  });

  afterAll(async () => {
    await client?.close();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([db.collection("tbookevents").deleteMany({}), db.collection("tbookbookings").deleteMany({})]);
  });

  async function seedEvent(overrides: Record<string, unknown> = {}) {
    const _id = new ObjectId();
    await db.collection("tbookevents").insertOne({ _id, name: "Event", capacity: 100, soldGuestCount: 0, ...overrides });
    return _id;
  }

  async function seedBooking(eventId: ObjectId, status: string, guests: number) {
    await db.collection("tbookbookings").insertOne({ eventId, status, guests });
  }

  it("sums guests only for statuses that still hold a reservation", async () => {
    const eventId = await seedEvent();
    await seedBooking(eventId, "pending", 2);
    await seedBooking(eventId, "checkout_started", 3);
    await seedBooking(eventId, "paid", 4);
    await seedBooking(eventId, "confirmed", 1);
    // Neither of these holds a seat — expireBooking/cancelBooking release it.
    await seedBooking(eventId, "expired", 50);
    await seedBooking(eventId, "cancelled", 50);

    const { changes } = await computeBackfillChanges(db);
    expect(changes).toHaveLength(1);
    expect(changes[0].actual).toBe(10);

    await applyBackfillChanges(db, changes);
    const event = await db.collection("tbookevents").findOne({ _id: eventId });
    expect(event?.soldGuestCount).toBe(10);
  });

  it("is idempotent — a second run finds nothing to change", async () => {
    const eventId = await seedEvent();
    await seedBooking(eventId, "paid", 7);

    const first = await computeBackfillChanges(db);
    await applyBackfillChanges(db, first.changes);

    const second = await computeBackfillChanges(db);
    expect(second.changes).toHaveLength(0);
  });

  it("corrects a counter that drifted above the real total", async () => {
    const eventId = await seedEvent({ soldGuestCount: 999 });
    await seedBooking(eventId, "paid", 3);

    const { changes } = await computeBackfillChanges(db);
    await applyBackfillChanges(db, changes);
    const event = await db.collection("tbookevents").findOne({ _id: eventId });
    expect(event?.soldGuestCount).toBe(3);
  });

  it("treats a legacy event with no soldGuestCount field as 0 and sets it", async () => {
    const eventId = new ObjectId();
    // Exactly the legacy shape: the field was never written by the old plugin.
    await db.collection("tbookevents").insertOne({ _id: eventId, name: "Legacy", capacity: 50 });
    await seedBooking(eventId, "paid", 6);

    const { changes } = await computeBackfillChanges(db);
    await applyBackfillChanges(db, changes);
    const event = await db.collection("tbookevents").findOne({ _id: eventId });
    expect(event?.soldGuestCount).toBe(6);
  });

  it("skips uncapped events by default and includes them with allEvents", async () => {
    const uncapped = await seedEvent({ capacity: null, name: "Uncapped" });
    await seedBooking(uncapped, "paid", 5);

    expect((await computeBackfillChanges(db)).examined).toBe(0);

    const all = await computeBackfillChanges(db, { allEvents: true });
    expect(all.examined).toBe(1);
    expect(all.changes[0].actual).toBe(5);
  });

  it("reports an event whose real total already exceeds its capacity", async () => {
    const eventId = await seedEvent({ capacity: 5 });
    await seedBooking(eventId, "paid", 9);

    const { changes } = await computeBackfillChanges(db);
    expect(changes[0].actual).toBeGreaterThan(changes[0].event.capacity);
  });

  it("leaves an event with no bookings at 0 without reporting a change", async () => {
    await seedEvent();
    const { examined, changes } = await computeBackfillChanges(db);
    expect(examined).toBe(1);
    expect(changes).toHaveLength(0);
  });
});
