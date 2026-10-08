# tbook

Standalone rebuild of the multi-tenant event/tournament booking platform
(previously a plugin inside `webshop-engine`). See
`/Users/tomko/.claude/plans/giggly-discovering-elephant.md` for the full
architecture and phased rollout plan this scaffold implements.

## Layout

```
apps/web/           Next.js app (App Router): storefront + admin route groups, api/v1 + api/v2
packages/schemas/    Zod schemas — single source of truth for entity + API shapes
packages/db/         Mongoose connection + models + repositories
packages/domain/     Pure business logic (pricing, eligibility, VAT, wizard-flow)
packages/services/   Orchestration: booking, checkout, voucher, invoice, org/RBAC, tDarts sync
packages/actions/    Request-layer: auth/permission checks, input validation, error mapping
packages/ui/         Shared component library (design system), component-tested
```

Request layering: `route.ts → actions/* → services/* → domain/* + db/repositories/* → db/models/*`.

## Requirements

- Node >= 20
- A MongoDB instance. Production **must** point `DATABASE_URL` at the
  existing `tbook-admin` database to stay backwards compatible.

## Development

```bash
npm install --legacy-peer-deps  # vitest's peer graph trips an npm/arborist bug without this
cp apps/web/.env.example apps/web/.env.local   # fill in DATABASE_URL etc.
npm run dev
```

## Scripts

- `npm run lint` / `npm run typecheck` / `npm run build`
- `npm run test:unit` — unit + component tests (Vitest, no external services)
- `npm run test:integration` — API/DB tests against `mongodb-memory-server`
- `npm run test:concurrency` — race-condition tests (e.g. booking capacity)

A Husky pre-push hook runs lint + typecheck + unit tests + build before
anything reaches the remote.

## Refreshing a dev database from production

```bash
node scripts/migrate/clone-database.mjs --uri mongodb://host:27017/ \
  --from tbook-admin --to tbook-dev            # dry run: prints the plan
node scripts/migrate/clone-database.mjs --uri mongodb://host:27017/ \
  --from tbook-admin --to tbook-dev --yes      # perform the copy
```

Drops and replaces the target's matching collections, recreating the
source's indexes (the unique `token` and `(bookingId, attendeeIndex)`
indexes on `tbookvouchers` matter — without them a dev database would
accept data production rejects). Refuses to write without `--yes`, refuses
when source and target match, and refuses a production-looking target
unless `--allow-prod-target` is also passed. Run `backfill:capacity`
against the fresh copy afterwards.

Note that a faithful copy carries real customer names, emails and phone
numbers into the dev database — treat it accordingly.

## Launching against the legacy database

`soldGuestCount` on `tbookevents` is **authoritative** in this rebuild —
`eventRepository.reserveCapacity` guards capacity with it to close the
legacy oversell race — but it was vestigial in the legacy plugin, which
re-aggregated bookings on every check. So before pointing this app at a
real `tbook-admin` database, reconcile the counter or every event will read
as fully available:

```bash
DATABASE_URL=mongodb://host/tbook-admin npm run backfill:capacity -- --dry-run
DATABASE_URL=mongodb://host/tbook-admin npm run backfill:capacity
```

It is idempotent and safe to re-run (and should be re-run after any
out-of-band booking edit made directly in the database). Pass
`--all-events` to also reconcile events with no capacity cap.

## Integrations (outbound webhooks)

Wiring tBook to another system (Zapier/Make/n8n, a CRM, a Slack relay, your
own service) is configuration, not a code change: add an endpoint under
**Admin → Integrations** (or `POST /api/v2/admin/webhooks`) and subscribe it
to `booking.paid`, `booking.cancelled` and/or `voucher.checked_in`.

Each delivery is a `POST` carrying `X-TBook-Event`, `X-TBook-Delivery` and
`X-TBook-Signature: sha256=<hex HMAC-SHA256 of the raw body>` — the same
scheme Stripe and GitHub use. Verify against the **raw** body before
parsing, and compare in constant time. The signing secret is shown once at
creation and is unrecoverable afterwards.

Deliveries are best-effort and not retried: a failing endpoint must never
block a booking from being paid or cancelled. Each endpoint's last status
is recorded and shown in the console, so a broken integration is visible
without log access.

For integrations that need to run *inside* the app rather than over HTTP,
the extension point is `AFTER_BOOKING_PAID_HOOKS` in
`packages/services/src/checkout-service.ts` — invoicing, tDarts sync,
voucher delivery and webhook dispatch all register into it the same way.

## Backwards compatibility

- Same MongoDB collections/fields as the legacy plugin (see
  `scripts/migration-fixtures/` for real anonymized legacy documents used in
  the compatibility test suite).
- The legacy public API path `/api/plugins/t-book/*` is rewritten to
  `/api/v1/*` (see `apps/web/next.config.ts`) so the still-running Sörfeszt
  and World Darts Festival storefronts need no changes.
- `/api/v2/*` is the new contract for this rebuild's own frontend.

## Deployment

`Dockerfile` builds a standalone Next.js image (multi-stage, non-root user).
`portainer.stack.tbook.example.yml` is the deployment template — copy it to
a gitignored `portainer.stack.tbook.yml`, fill in secrets, and deploy via
Portainer. Never commit the filled-in file.
