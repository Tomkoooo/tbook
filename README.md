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

# REQUIRED before exercising any payment flow against the copy:
node scripts/migrate/sanitize-dev-database.mjs --uri mongodb://host:27017/ --db tbook-dev

DATABASE_URL=mongodb://host:27017/tbook-dev npm run backfill:capacity
```

**Sanitize before testing.** A faithful clone carries every organization's
real credentials — the Számlázz.hu agent key, the SMTP password, the Stripe
secret key, the tDarts partner secret. Marking one booking paid in such a
database runs the full after-payment pipeline, which would issue a *real*
invoice, email a *real* customer and enrol someone into a *real* tournament
roster. `sanitize-dev-database.mjs` disables those integrations and clears
any configured webhook endpoints; pass `--redirect-email you@example.com`
to also point every customer address at yourself so voucher delivery can be
exercised safely.

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

## Managing registrations

The admin console covers the cases the storefront cannot:

- **Register by hand** (`/admin/bookings/new`) — individual or team/pair
  entries. The event's own `registrationUnit` / `playersPerTicket` /
  `teamMemberFieldSchema` drive the form, so a pairs event asks for both
  players and a 5-a-side team asks for its roster. Four rules can be
  knowingly overridden (closed sales window, inactive event, over capacity,
  eligibility), each off by default.
- **Record a payment taken outside the platform** — bank transfer, cash, or
  a comped entry, with a reference and note, attributed to the manager who
  recorded it. This runs the same after-payment pipeline a Stripe webhook
  does, so entries, the invoice and the integrations all happen as normal.
- **Edit contact details and attendee/roster data** — renaming an attendee
  re-points their entry ticket. Entries already checked in are left alone
  (they record who was admitted) and reported as skipped.
- **Attach an invoice number and PDF** issued from another system, for an
  org that invoices from its own accounting software or whose automatic
  Számlázz.hu issue failed.

tDarts: enrolment happens automatically on payment. Correcting a name or
withdrawing a cancelled entry is **not yet possible** — the tDarts partner
API is create-only. The console surfaces a warning when an edit leaves the
tournament roster stale; see `docs/tdarts-partner-api-requirements.md` for
the two endpoints that would close this.

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

## Day-pass events

An event with `kind: "day_pass"` sells passes for individual days of a
long run (say a month), at a weekday or weekend price, with a capacity per
day. Backwards compatible: every existing event is `kind: "standard"` and
behaves exactly as before.

On the public API, `GET /api/v1/events` returns `kind` and, for a day-pass
event, `dayPass.days[]` — `{ date, weekend, unitPriceGrossHuf, remaining,
closed, bookable }` per day (sold counts are never exposed). The buyer's
basket travels in `selections`:

```json
POST /api/v1/quote   (and POST /api/v1/bookings)
{ "eventId": "…", "guests": 1, "customer": { … },
  "selections": { "dayPasses": { "2026-07-04": 2, "2026-07-05": 1 } } }
```

`guests` is ignored for a day-pass event — the size of the basket decides
it. Reserving the basket is all-or-nothing: every day's counter lives on
the event document, so one atomic update checks and increments them all
(`eventRepository.reserveDayCapacity`). Each ticket becomes a voucher dated
to its day; the door scanner answers `wrong_day` outside that date (the
venue's time zone is `Europe/Budapest`).

## Point of sale

`/admin/sales` is the seller screen: pick an event (or, for a day-pass
event, the days), take cash or card, enter the customer and billing
details. The sale is recorded as paid (`source: "pos"`), the ticket PDF is
emailed, the Számlázz.hu invoice is issued with the real payment method
and its PDF is emailed too. A seller needs the `sale:create` permission;
`booking:manage` also works, so existing Owner roles can sell without a
role edit. A seller can never override capacity or the sales window.

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
