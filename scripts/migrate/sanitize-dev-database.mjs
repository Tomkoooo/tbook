#!/usr/bin/env node
/**
 * Disarms the outbound integrations in a database cloned from production.
 *
 * Why this is not optional. A faithful clone carries every organization's
 * real credentials: the Számlázz.hu agent key, the SMTP password, the
 * Stripe secret key and the tDarts partner secret. Marking a single booking
 * paid in such a database runs the full after-payment pipeline, which would
 * issue a REAL invoice against the organization's Számlázz.hu account,
 * email a REAL customer, and enrol someone into a REAL tournament roster.
 * None of that is undoable from here.
 *
 * So: clone, sanitize, then test. Never test against a fresh clone.
 *
 * Also clears any configured outbound webhook endpoints, which would
 * otherwise POST dev events to the organization's production receivers.
 *
 * Usage:
 *   node scripts/migrate/sanitize-dev-database.mjs --uri mongodb://host:27017/ --db tbook-dev
 *   node scripts/migrate/sanitize-dev-database.mjs --db tbook-dev --redirect-email you@example.com
 *
 * Flags:
 *   --db <name>              database to sanitize (required)
 *   --uri <mongodb://...>    server URI (default: MONGO_SERVER_URI, else DATABASE_URL)
 *   --redirect-email <addr>  rewrite every customer/voucher email to this
 *                            address, so voucher delivery can be exercised
 *                            without mailing real people
 *   --dry-run                report what would change, write nothing
 */
const { MongoClient } = await import("mongodb");

/** Refuses to touch a database whose name looks like production. */
const PROD_PATTERN = /(^|[-_])(prod|production|live)([-_]|$)|^tbook-admin$/i;

function parseArgs(argv) {
  const flags = { db: null, uri: process.env.MONGO_SERVER_URI || null, redirectEmail: null, dryRun: false, force: false };
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
    if (arg === "--db") flags.db = next();
    else if (arg === "--uri") flags.uri = next();
    else if (arg === "--redirect-email") flags.redirectEmail = next();
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--allow-prod-target") flags.force = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return flags;
}

function serverUriFrom(raw) {
  const url = new URL(raw);
  url.pathname = "/";
  return url.toString();
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.db) {
    console.error("--db is required.");
    process.exit(2);
  }
  if (PROD_PATTERN.test(flags.db) && !flags.force) {
    console.error(`"${flags.db}" looks like production. Refusing. (--allow-prod-target to override, which you almost certainly do not want.)`);
    process.exit(2);
  }

  const rawUri = flags.uri || process.env.DATABASE_URL;
  if (!rawUri) {
    console.error("No server URI. Pass --uri, or set MONGO_SERVER_URI or DATABASE_URL.");
    process.exit(2);
  }

  const client = new MongoClient(serverUriFrom(rawUri), { serverSelectionTimeoutMS: 10_000 });
  await client.connect();

  try {
    const db = client.db(flags.db);
    const orgs = db.collection("tbookorganizations");
    const dryRun = flags.dryRun;

    console.log(`${dryRun ? "PLAN (dry run)" : "SANITIZING"}: ${flags.db}\n`);

    for (const org of await orgs.find({}).toArray()) {
      const s = org.settings ?? {};
      const actions = [];
      if (s.stripe?.enabled) actions.push("stripe off");
      if (s.szamlazz?.enabled) actions.push("szamlazz off");
      if (s.tdarts?.enabled) actions.push("tdarts off");
      if (s.smtp?.host) actions.push("smtp cleared");
      if ((s.webhooks ?? []).length > 0) actions.push(`${s.webhooks.length} webhook(s) removed`);

      console.log(`  ${org.name}: ${actions.length > 0 ? actions.join(", ") : "already clean"}`);

      if (dryRun || actions.length === 0) continue;

      await orgs.updateOne(
        { _id: org._id },
        {
          $set: {
            // Flags only — the encrypted secrets are left in place so the
            // documents stay shaped exactly like production, which is the
            // point of testing against a clone. Nothing reads them while
            // `enabled` is false.
            "settings.stripe.enabled": false,
            "settings.szamlazz.enabled": false,
            "settings.tdarts.enabled": false,
            // Mail is gated on the host, not an enabled flag, so it has to
            // be blanked rather than switched off.
            "settings.smtp.host": "",
            "settings.smtp.user": "",
            "settings.smtp.passEnc": "",
            "settings.webhooks": [],
          },
        },
      );
    }

    if (flags.redirectEmail) {
      const email = flags.redirectEmail.trim().toLowerCase();
      const bookings = db.collection("tbookbookings");
      const vouchers = db.collection("tbookvouchers");

      const bookingCount = await bookings.countDocuments({});
      console.log(`\n  redirecting ${bookingCount} booking email(s) to ${email}`);

      if (!dryRun) {
        await bookings.updateMany({}, { $set: { "customer.email": email } });
        await vouchers.updateMany({ lastSentToEmail: { $ne: null } }, { $set: { lastSentToEmail: email } });
      }
    }

    console.log(
      dryRun
        ? "\n--dry-run: nothing written."
        : "\nDone. Outbound integrations are disabled; this database is safe to exercise payment flows against.",
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
