#!/usr/bin/env node
/**
 * Reconciles `tbookevents.soldGuestCount` from the actual booking rows.
 *
 * Why this exists: the legacy plugin treated `soldGuestCount` as a
 * vestigial field and derived remaining capacity by aggregating
 * `tbookbookings` on every check. This rebuild makes the counter
 * authoritative — `eventRepository.reserveCapacity` guards capacity with
 * `$expr` against it (packages/db/src/repositories/event-repository.ts) to
 * close the legacy oversell race. Pointing the new app at a legacy
 * `tbook-admin` database without running this first means every event
 * reads as `soldGuestCount: 0`, i.e. fully available, and the new app
 * would happily oversell.
 *
 * Run it against the legacy DB before the first launch, and again after
 * any out-of-band booking edit made directly in the database.
 *
 * Deliberately plain JS on the raw MongoDB driver rather than Mongoose:
 * this is a data reconciliation against the legacy collection names, so it
 * should not depend on the app's model layer (or on any TS build step).
 *
 * Usage:
 *   node scripts/migrate/backfill-sold-guest-count.mjs --dry-run
 *   node scripts/migrate/backfill-sold-guest-count.mjs
 *   DATABASE_URL=mongodb://host/tbook-admin node scripts/migrate/backfill-sold-guest-count.mjs
 *
 * Flags:
 *   --dry-run          report what would change, write nothing
 *   --all-events       also reconcile events with no capacity cap (default:
 *                      only events where capacity is set, since those are
 *                      the only ones reserveCapacity consults)
 *   --uri=<mongodb://> override DATABASE_URL
 */
import { MongoClient } from "mongodb";

/**
 * Statuses that hold a live capacity reservation. Mirrors the service
 * layer exactly: createPendingBooking reserves on create, while
 * expireBooking and cancelBooking release — so pending, checkout_started,
 * paid and confirmed are the states still holding a seat. Keep in sync
 * with packages/services/src/booking-service.ts.
 */
export const RESERVING_STATUSES = ["pending", "checkout_started", "paid", "confirmed"];

/**
 * Diffs stored vs. actual reserved guest counts. Pure read — returns the
 * pending changes so both --dry-run and the real run share one code path
 * (and so the integration test can assert on the diff directly).
 */
export async function computeBackfillChanges(db, { allEvents = false } = {}) {
  const events = db.collection("tbookevents");
  const bookings = db.collection("tbookbookings");

  // Only capacity-capped events matter to reserveCapacity; --all-events
  // widens it so the counter is accurate everywhere (useful for admin
  // dashboards that display it regardless of a cap).
  const eventFilter = allEvents ? {} : { capacity: { $ne: null, $exists: true } };
  const eventDocs = await events.find(eventFilter).project({ _id: 1, name: 1, capacity: 1, soldGuestCount: 1 }).toArray();

  // One grouped pass over the bookings rather than a query per event.
  const grouped = await bookings
    .aggregate([
      { $match: { status: { $in: RESERVING_STATUSES } } },
      { $group: { _id: "$eventId", total: { $sum: { $ifNull: ["$guests", 0] } } } },
    ])
    .toArray();
  const actualByEventId = new Map(grouped.map((row) => [String(row._id), row.total]));

  const changes = [];
  for (const event of eventDocs) {
    const actual = actualByEventId.get(String(event._id)) ?? 0;
    const stored = typeof event.soldGuestCount === "number" ? event.soldGuestCount : 0;
    if (actual !== stored) changes.push({ event, stored, actual });
  }
  return { examined: eventDocs.length, changes };
}

/** Applies the diff. Returns the number of event documents modified. */
export async function applyBackfillChanges(db, changes) {
  if (changes.length === 0) return 0;
  const ops = changes.map(({ event, actual }) => ({
    updateOne: { filter: { _id: event._id }, update: { $set: { soldGuestCount: actual } } },
  }));
  const written = await db.collection("tbookevents").bulkWrite(ops, { ordered: false });
  return written.modifiedCount;
}

function parseArgs(argv) {
  const flags = { dryRun: false, allEvents: false, uri: process.env.DATABASE_URL };
  for (const arg of argv) {
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--all-events") flags.allEvents = true;
    else if (arg.startsWith("--uri=")) flags.uri = arg.slice("--uri=".length);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return flags;
}

async function main() {
  const { dryRun, allEvents, uri } = parseArgs(process.argv.slice(2));
  if (!uri) {
    console.error("DATABASE_URL is not set (or pass --uri=mongodb://host/tbook-admin)");
    process.exit(2);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const { examined, changes } = await computeBackfillChanges(db, { allEvents });

    console.log(`Events examined:   ${examined}${allEvents ? " (all)" : " (capacity-capped only)"}`);
    console.log(`Events to update:  ${changes.length}`);

    for (const { event, stored, actual } of changes) {
      const cap = event.capacity == null ? "uncapped" : `cap ${event.capacity}`;
      const over = event.capacity != null && actual > event.capacity ? "  ** ALREADY OVER CAPACITY **" : "";
      console.log(`  ${String(event._id)}  ${stored} -> ${actual}  (${cap})  ${event.name ?? "(unnamed)"}${over}`);
    }

    if (changes.length === 0) {
      console.log("Already consistent — nothing written.");
      return;
    }
    if (dryRun) {
      console.log("\n--dry-run: no writes performed.");
      return;
    }

    const modified = await applyBackfillChanges(db, changes);
    console.log(`\nUpdated ${modified} event document(s).`);
  } finally {
    await client.close();
  }
}

// Only self-execute as a CLI — importing this module (e.g. from the
// integration test) must not connect to anything.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
