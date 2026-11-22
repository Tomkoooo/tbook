#!/usr/bin/env node
/**
 * Grants the three "core" feature modules to every organization that exists
 * today: Point of sale (`point-of-sale`), Hotels (`hotels`) and Ticket
 * selling (`ticket-sales`).
 *
 * Why this exists: these used to be always-on console pages. They are now
 * feature modules (packages/modules), granted per organization by a system
 * admin, so a *new* organization starts without them. Existing organizations
 * must keep working exactly as before, so this writes the entitlement for
 * all of them. The modules default to on for every event of an entitled
 * organization (defaultOn), so no event or group documents are touched.
 *
 * Safe to re-run: an organization that already has an entry for a module
 * (granted, or deliberately withdrawn by a system admin since) is left alone.
 *
 * RUN THIS BEFORE (or together with) deploying the version that registers
 * these modules; until it has run, existing organizations lose those pages.
 *
 * Deliberately plain JS on the raw MongoDB driver (see the other scripts in
 * this folder): it should not depend on the app's model layer or a TS build.
 *
 * Usage:
 *   node scripts/migrate/enable-core-modules.mjs --dry-run
 *   node scripts/migrate/enable-core-modules.mjs
 *   DATABASE_URL=mongodb://host/tbook-admin node scripts/migrate/enable-core-modules.mjs
 *
 * Flags:
 *   --dry-run          report what would change, write nothing
 *   --uri=<mongodb://> override DATABASE_URL
 */
import { MongoClient } from "mongodb";

/** Keep in sync with packages/modules/src/{point-of-sale,hotels,ticket-sales}. */
export const CORE_MODULE_KEYS = ["point-of-sale", "hotels", "ticket-sales"];

/**
 * Pure read: which organizations lack which core module entries. Both
 * --dry-run and the real run (and the integration test) share this.
 */
export async function computeCoreModuleGrants(db) {
  const orgs = await db.collection("tbookorganizations").find({}).project({ _id: 1, name: 1, modules: 1 }).toArray();
  const grants = [];
  for (const org of orgs) {
    const modules = org.modules && typeof org.modules === "object" ? org.modules : {};
    const missing = CORE_MODULE_KEYS.filter((key) => modules[key] === undefined || modules[key] === null);
    if (missing.length > 0) grants.push({ org, missing });
  }
  return { examined: orgs.length, grants };
}

/**
 * Applies the grants, one guarded write per (organization, module). The
 * filter `{ "modules.<key>": null }` matches a missing or null entry only,
 * so nothing written since the read (or by a concurrent run) is overwritten.
 * Returns the number of module entries written.
 */
export async function applyCoreModuleGrants(db, grants, now = new Date()) {
  if (grants.length === 0) return 0;
  const organizations = db.collection("tbookorganizations");
  // A legacy document may store `modules: null`, which a dotted $set cannot extend.
  await organizations.updateMany({ modules: null }, { $set: { modules: {} } });
  const ops = grants.flatMap(({ org, missing }) =>
    missing.map((key) => ({
      updateOne: {
        filter: { _id: org._id, [`modules.${key}`]: null },
        update: { $set: { [`modules.${key}`]: { enabled: true, config: {}, changedBy: null, changedAt: now } } },
      },
    })),
  );
  const written = await organizations.bulkWrite(ops, { ordered: false });
  return written.modifiedCount;
}

function parseArgs(argv) {
  const flags = { dryRun: false, uri: process.env.DATABASE_URL };
  for (const arg of argv) {
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--uri=")) flags.uri = arg.slice("--uri=".length);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return flags;
}

async function main() {
  const { dryRun, uri } = parseArgs(process.argv.slice(2));
  if (!uri) {
    console.error("DATABASE_URL is not set (or pass --uri=mongodb://host/tbook-admin)");
    process.exit(2);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const { examined, grants } = await computeCoreModuleGrants(db);

    console.log(`Organizations examined:  ${examined}`);
    console.log(`Organizations to update: ${grants.length}`);
    for (const { org, missing } of grants) {
      console.log(`  ${String(org._id)}  ${org.name ?? "(unnamed)"}  + ${missing.join(", ")}`);
    }

    if (grants.length === 0) {
      console.log("Already up to date — nothing written.");
      return;
    }
    if (dryRun) {
      console.log("\n--dry-run: no writes performed.");
      return;
    }

    const modified = await applyCoreModuleGrants(db, grants);
    console.log(`\nWrote ${modified} module entr${modified === 1 ? "y" : "ies"}.`);
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
