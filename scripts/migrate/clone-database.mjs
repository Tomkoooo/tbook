#!/usr/bin/env node
/**
 * Clones one MongoDB database over another on the same server — the
 * "refresh my dev database from production" tool.
 *
 * The target's matching collections are DROPPED and replaced. Collections
 * that exist only in the target are left alone unless --prune is passed.
 *
 * Safety rails, because this drops data:
 *   - requires --yes to write anything (otherwise it only reports a plan)
 *   - refuses when source and target are the same database
 *   - refuses to write to a target that looks like production unless
 *     --allow-prod-target is passed as well
 *
 * Deliberately plain JS on the raw driver: it operates on collections, not
 * on the app's model layer, and must not depend on a TS build.
 *
 * Usage:
 *   node scripts/migrate/clone-database.mjs --from tbook-admin --to tbook-dev
 *   node scripts/migrate/clone-database.mjs --from tbook-admin --to tbook-dev --yes
 *
 * Flags:
 *   --from <db>            source database name (required)
 *   --to <db>              target database name (required)
 *   --uri <mongodb://...>  server URI (default: MONGO_SERVER_URI, else DATABASE_URL's host)
 *   --yes                  actually perform the copy (without it: dry run)
 *   --prune                also drop target collections absent from the source
 *   --only <a,b,c>         restrict to these collections
 *   --allow-prod-target    permit a target whose name looks production-like
 *   --batch <n>            insert batch size (default 1000)
 */
const { MongoClient } = await import("mongodb");

/** Names that must not be written to without an explicit override. */
const PROD_TARGET_PATTERN = /(^|[-_])(prod|production|live)([-_]|$)|^tbook-admin$/i;

const INDEX_SKIP = new Set(["_id_"]);

function parseArgs(argv) {
  const flags = {
    from: null,
    to: null,
    uri: process.env.MONGO_SERVER_URI || null,
    yes: false,
    prune: false,
    only: null,
    allowProdTarget: false,
    batch: 1000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value == null) {
        console.error(`${arg} needs a value`);
        process.exit(2);
      }
      i += 1;
      return value;
    };

    if (arg === "--from") flags.from = next();
    else if (arg === "--to") flags.to = next();
    else if (arg === "--uri") flags.uri = next();
    else if (arg === "--yes") flags.yes = true;
    else if (arg === "--prune") flags.prune = true;
    else if (arg === "--allow-prod-target") flags.allowProdTarget = true;
    else if (arg === "--only") flags.only = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--batch") flags.batch = Number(next()) || 1000;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return flags;
}

/** Strips any database/path off a URI so client.db(name) picks the database. */
function serverUriFrom(raw) {
  const url = new URL(raw);
  url.pathname = "/";
  return url.toString();
}

async function copyCollection(sourceDb, targetDb, name, { batch, dryRun }) {
  const source = sourceDb.collection(name);
  const total = await source.countDocuments();

  if (dryRun) return { name, total, copied: 0, indexes: 0 };

  // Drop rather than deleteMany: it clears indexes too, so the target ends
  // up with exactly the source's index set rather than a union of both.
  await targetDb.collection(name).drop().catch((error) => {
    // NamespaceNotFound just means the target didn't have it yet.
    if (error?.codeName !== "NamespaceNotFound") throw error;
  });

  const target = targetDb.collection(name);
  let copied = 0;
  let buffer = [];

  const cursor = source.find({}, { raw: false });
  for await (const doc of cursor) {
    buffer.push(doc);
    if (buffer.length >= batch) {
      // ordered:false so one bad document doesn't abort the whole batch.
      await target.insertMany(buffer, { ordered: false });
      copied += buffer.length;
      buffer = [];
    }
  }
  if (buffer.length > 0) {
    await target.insertMany(buffer, { ordered: false });
    copied += buffer.length;
  }

  // Recreate the source's indexes. Unique indexes matter for correctness
  // here: tbookvouchers has a unique token index and a unique
  // (bookingId, attendeeIndex) compound, and losing them in dev would let
  // the dev database accept data production would reject.
  let indexes = 0;
  for (const index of await source.indexes()) {
    if (INDEX_SKIP.has(index.name)) continue;
    const { key, name: indexName, v: _v, ...options } = index;
    try {
      await target.createIndex(key, { name: indexName, ...options });
      indexes += 1;
    } catch (error) {
      console.warn(`    ! index ${indexName} failed: ${error.message}`);
    }
  }

  return { name, total, copied, indexes };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (!flags.from || !flags.to) {
    console.error("Both --from and --to are required.");
    process.exit(2);
  }
  if (flags.from === flags.to) {
    console.error("--from and --to are the same database. Refusing.");
    process.exit(2);
  }
  if (PROD_TARGET_PATTERN.test(flags.to) && !flags.allowProdTarget) {
    console.error(`Target "${flags.to}" looks like production. Pass --allow-prod-target if you really mean it.`);
    process.exit(2);
  }

  const rawUri = flags.uri || process.env.DATABASE_URL;
  if (!rawUri) {
    console.error("No server URI. Pass --uri, or set MONGO_SERVER_URI or DATABASE_URL.");
    process.exit(2);
  }
  const uri = serverUriFrom(rawUri);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();

  try {
    const sourceDb = client.db(flags.from);
    const targetDb = client.db(flags.to);

    const sourceNames = (await sourceDb.listCollections().toArray())
      .map((c) => c.name)
      .filter((name) => !name.startsWith("system."))
      .filter((name) => !flags.only || flags.only.includes(name))
      .sort();

    const targetNames = (await targetDb.listCollections().toArray()).map((c) => c.name);

    if (sourceNames.length === 0) {
      console.error(`No matching collections in ${flags.from}.`);
      process.exit(1);
    }

    const dryRun = !flags.yes;
    console.log(`${dryRun ? "PLAN (dry run)" : "COPYING"}: ${flags.from} -> ${flags.to} on ${uri}`);
    console.log(`Collections: ${sourceNames.length}\n`);

    let grandTotal = 0;
    for (const name of sourceNames) {
      const result = await copyCollection(sourceDb, targetDb, name, { batch: flags.batch, dryRun });
      grandTotal += result.total;
      const existed = targetNames.includes(name) ? " (replaced)" : "";
      console.log(
        dryRun
          ? `  ${name.padEnd(28)} ${String(result.total).padStart(7)} docs${existed}`
          : `  ${name.padEnd(28)} ${String(result.copied).padStart(7)}/${result.total} docs, ${result.indexes} index(es)${existed}`,
      );
    }

    const orphans = targetNames.filter((name) => !name.startsWith("system.") && !sourceNames.includes(name));
    if (orphans.length > 0) {
      console.log(`\nIn target only (${flags.prune ? "pruning" : "left untouched"}): ${orphans.join(", ")}`);
      if (flags.prune && !dryRun) {
        for (const name of orphans) await targetDb.collection(name).drop().catch(() => undefined);
      }
    }

    console.log(`\n${dryRun ? "Would copy" : "Copied"} ${grandTotal} document(s) across ${sourceNames.length} collection(s).`);
    if (dryRun) console.log("Nothing was written. Re-run with --yes to perform the copy.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
