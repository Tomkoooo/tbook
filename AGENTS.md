# Agent instructions (tBook)

tBook is a multi-tenant event booking platform: events and tickets, lodging,
door check-in, a counter point of sale, merchandise with shared stock,
Számlázz.hu invoices and receipts. Admins work in the console (`/admin`);
storefronts and the webshop use its APIs.

| Task | Read first |
|---|---|
| Build a customer site on tBook (sironic-platform, own site repo) | [docs/site-integration-guide.md](docs/site-integration-guide.md) |
| Ticket/booking API (v1, public) | [docs/storefront-api.md](docs/storefront-api.md) |
| Products & stock API (v2 inventory) | [docs/inventory-api.md](docs/inventory-api.md) |
| Any console UI change | [design-system/MASTER.md](design-system/MASTER.md) |
| Operations, deployment, migrations | [README.md](README.md) |

## Layout

```
apps/web                 Next.js 15 (App Router): console (app/(admin)), storefront stubs, api/v1, api/v2
packages/schemas         Zod schemas + types — the shape of every entity and API input
packages/db              Mongoose models + repositories
packages/domain          Pure logic (pricing, VAT, variants, email templates) — no I/O, unit-tested
packages/services        Orchestration (bookings, checkout, invoices, receipts, inventory, blobs…)
packages/actions         ActionError + parseInput (request-layer helpers)
scripts/migrate          Plain-JS data migrations (raw MongoDB driver), each with an integration test
```

Request flow: `route.ts` / server action → `@tbook/services` → `@tbook/domain`
and `@tbook/db`. Routes and actions only check auth and parse input; rules
live in services and domain.

## Commands

```bash
npm run dev                  # console at http://localhost:3000/admin
npm run typecheck            # all workspaces
npm run lint
npm test                     # unit tests (fast, no DB)
npm run test:integration     # mongodb-memory-server; needed for anything touching the DB
```

Run typecheck, lint and both test suites before calling work done.

## Rules

**UI (console).** Use shadcn components (`apps/web/src/components/ui`) and the
app building blocks in `apps/web/src/components` (`PageTitle`, `SectionCard`,
`FormField`, `NativeSelect`, `CheckboxField`, `Notice`, `StickyFormFooter`,
`RichTextEditor`, `ImageManager`, …). No raw `<button>`/`<input>`/`<table>`, no
inline styles, no one-off CSS classes. Colours come only from semantic
tokens (`bg-card`, `text-muted-foreground`, `bg-success-muted`); status colours
come from `lib/status-tones.ts`. Long forms end with `StickyFormFooter`.

**Server actions** re-check the permission themselves (`requireOrgPermission`)
and return a plain `{ ok, message }` result for inline display. Never trust a
hidden field for authorization.

**Permissions.** New permissions go in `packages/schemas/src/permissions.ts`
and `apps/web/src/lib/permission-labels.ts`. Roles saved before a permission
existed don't have it, so add a fallback to an existing permission (see
`lib/product-access.ts`: `product:write` or `event:write`).

**Money.** Prices are stored **gross** in the organization's currency; net is
derived from VAT. HUF gross amounts are whole forints.

**Files: none on disk.** Uploads go to the MongoDB blob store
(`services/blob-store.ts`: content-addressed, owner + kind, mark-and-sweep
cleanup). Ticket PDFs are rendered on demand; Számlázz.hu invoice and receipt
PDFs are fetched from Számlázz.hu. `media-storage.ts` is read-only legacy.
Never add a filesystem write.

**Stock** changes only through `services/inventory-service.ts` (atomic,
guarded updates and a movement log). Never `$set` a variant's stock elsewhere.

**Multi-tenancy.** Every query is scoped by `organizationId`. Blobs check
ownership. A route serving a file must check that the caller's organization
owns it.

**User-provided HTML** (product descriptions) is sanitized on save
(`services/rich-text.ts`). Previews of admin HTML render in a sandboxed
iframe.

**External calls** (Számlázz.hu, Stripe, SumUp, tDarts, SMTP) go through a
provider/transporter parameter, so tests inject fakes. Tests never touch the
network.

## Gotchas

- **The local database may be production data.** When checking the console in a browser, look, don't save, unless the owner says it's a test database.
- **Don't run `next build` while `npm run dev` is running.** They share `apps/web/.next`, and the build breaks the dev server. For a verification build use `NEXT_DIST_DIR=.next-verify npx next build`, then delete `.next-verify` **and** run `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json` (Next rewrites both to point at the build folder).
- **Stale generated types.** Typecheck errors under `apps/web/.next/types` come from a running dev server, not from your code. Check with `npx tsc --noEmit -p apps/web/tsconfig.json | grep -v '^\.next/'`.
- **Keep v1's shapes.** `@sironic/plugin-tbook` (sironic-platform) is built on them. Don't rename or remove fields; add new endpoints, or extend v2, instead.
