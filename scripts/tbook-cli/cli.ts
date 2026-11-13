import { ActionError } from "@tbook/actions";
import { runBookingCommand } from "./commands/booking";
import { runEventCommand } from "./commands/event";
import { runGroupCommand } from "./commands/group";
import { runSetupCommand } from "./commands/setup";
import { dbDisconnectAll } from "./lib/env";
import { CliError } from "./lib/errors";

/**
 * tBook production data CLI — see README section "Managing production
 * data from the CLI" for the full safety model. In short:
 *
 *   - every write defaults to a dry run; --apply performs it
 *   - --apply also requires --prod-ack (this CLI always treats the
 *     connected database as production, regardless of its name)
 *   - every changed field is confirmed on its own (interactively, or via
 *     --confirm-field <name> once per field when not attached to a TTY)
 *   - every write leaves a restore point under backups/cli/<...>/ (the
 *     affected document(s) before/after, plus who/when/what) and most
 *     have an `event undo --dir <that path>` to reverse them
 *
 * Usage: npx tsx scripts/tbook-cli/cli.ts <entity> <action> [--flags]
 */

const HELP = `
tBook production data CLI — safe, scoped, audited.

Usage:
  npx tsx scripts/tbook-cli/cli.ts <entity> <action> [--flags]

Entities and actions:
  event     list | show | create | edit | archive | undo | groups
  group     list | edit | keys   (keys: API key hint, --reveal-preview, --rotate-preview, --rotate-api-key)
  booking   list | show | resend-voucher | purge-test   (purge-test --event <id>: delete the event's
            X-TBook-Test bookings, waitlist entries, claims, tickets, answers; no emails)
  setup     apply --plan <file.json> [--update]   (modules, data lists from spreadsheets, group, event, emails;
            --update brings an existing event's modules, module settings and emails in line with the plan)

Every command needs --org <idOrSlug>. Every write defaults to a dry run —
pass --apply --prod-ack to actually write (this CLI always treats the
connected database as production). --uri overrides DATABASE_URL.

A day-pass event's dayPass config (prices, schedule, discount codes — the
full shape in @tbook/schemas' dayPassConfigSchema) is set whole via
--day-pass-json <file> on "event create"/"event edit", alongside --set for
the event's scalar fields.

Examples:
  npx tsx scripts/tbook-cli/cli.ts event list --org horror-weeks
  npx tsx scripts/tbook-cli/cli.ts event show --org horror-weeks --id <eventId>
  npx tsx scripts/tbook-cli/cli.ts event edit --org horror-weeks --id <eventId> --set capacity=300
  npx tsx scripts/tbook-cli/cli.ts event edit --org horror-weeks --id <eventId> --set capacity=300 \\
      --apply --prod-ack
  npx tsx scripts/tbook-cli/cli.ts event create --org horror-weeks --set groupId=<id> --set name=X \\
      --set startDate=2026-10-30 --set endDate=2026-11-29 --set ticketFeeHuf=0 --set kind=day_pass \\
      --day-pass-json day-pass.json --apply --prod-ack
  npx tsx scripts/tbook-cli/cli.ts event archive --org horror-weeks --id <eventId> --apply --prod-ack
  npx tsx scripts/tbook-cli/cli.ts event undo --org horror-weeks --dir backups/cli/event-edit-... \\
      --apply --prod-ack
  npx tsx scripts/tbook-cli/cli.ts group edit --org horror-weeks --id <groupId> --set status=active \\
      --apply --prod-ack
  npx tsx scripts/tbook-cli/cli.ts group keys --org horror-weeks --id <groupId> --reveal-preview
  npx tsx scripts/tbook-cli/cli.ts group keys --org horror-weeks --id <groupId> --rotate-preview \\
      --apply --prod-ack --confirm ROTATE
  npx tsx scripts/tbook-cli/cli.ts booking list --org horror-weeks --status paid --q jane@example.com
  npx tsx scripts/tbook-cli/cli.ts booking resend-voucher --org horror-weeks --id <bookingId> \\
      --apply --prod-ack
  npx tsx scripts/tbook-cli/cli.ts booking purge-test --org eventstructure --event <eventId>
  npx tsx scripts/tbook-cli/cli.ts booking purge-test --org eventstructure --event <eventId> \\
      --apply --prod-ack --confirm PURGE
`;

async function main(): Promise<void> {
  const [entity, action, ...rest] = process.argv.slice(2);

  if (!entity || entity === "help" || entity === "--help" || entity === "-h") {
    console.log(HELP);
    return;
  }
  if (entity === "event") {
    await runEventCommand(action, rest);
    return;
  }
  if (entity === "group") {
    await runGroupCommand(action, rest);
    return;
  }
  if (entity === "setup") {
    await runSetupCommand(action, rest);
    return;
  }
  if (entity === "booking") {
    await runBookingCommand(action, rest);
    return;
  }
  console.log(HELP);
  throw new CliError(`Unknown entity "${entity}".`);
}

main()
  .catch((error: unknown) => {
    if (error instanceof CliError) {
      console.error(`\n${error.message}\n`);
    } else if (error instanceof ActionError) {
      console.error(`\n${error.message}`);
      if (error.details) console.error(JSON.stringify(error.details, null, 2));
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await dbDisconnectAll().catch(() => undefined);
  });
