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
