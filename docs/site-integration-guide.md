# Building a site on tBook (sironic-platform) — guide for agents

Read this before building a customer site that sells tBook tickets and/or
tBook products. It says **where the code goes**, **which system owns what**,
and **which API to call for each job**.

## 1. Where the code goes

Three places, each with its own job:

| Place | What lives there | Who changes it |
|---|---|---|
| `~/programing/tbook` (this repo) | The central backend: events, bookings, tickets, products & stock, invoices/receipts, console | Backend work only |
| `~/programing/sironic-platform` | Shared `@sironic/*` packages: `core`, `ui`, `cms`, `auth`, `admin`, `sdk`, `cli`, `plugin-shop`, `plugin-tbook` | Anything reusable across sites |
| `<customer>-site` (its **own repo**) | One customer's site: layout, content, plugin config, generated route stubs | Site-specific work |

A new site is **its own repository**, created from the template that ships
in `@sironic/cli` (`sironic-platform/packages/cli/template`):

```bash
cd ~/programing/sironic-platform
node scripts/pack.mjs <vendor-dir>                    # package tarballs (until the npm scope is published)
npx sironic create-site <customer>-site --vendor <vendor-dir> --plugins shop,tbook
```

Then follow the site's own `AGENTS.md` (from the template) and
`sironic-platform/docs/plan/` (especially `06-tbook-plugin.md` and
`07-site-template-and-cli.md`). Don't build sites inside
`webshop-engine`; that repo is only a source the platform was ported from.

The downloaded copy of the customer's current site (e.g.
`sironic-platform/pages2port/<site>`) is **design and content input**:
port its layout into the site's `app/(site)` layout and pages, and its copy
and images into the CMS. Don't copy its code or data model.

**Rule of thumb:** if a change would help the next site too, it belongs in a
`sironic-platform` package, not in the site repo. If it's about bookings,
tickets, stock or invoices for tBook-sold items, it belongs in tBook.

## 2. Who owns what

| Concern | Owner | How the site gets it |
|---|---|---|
| Events, ticket prices, capacity, attendee forms, entry lists, ticket PDFs, door check-in | **tBook** | `@sironic/plugin-tbook` → storefront API v1 ([storefront-api.md](storefront-api.md)) |
| Ticket payment, ticket invoices, ticket emails | **tBook** (org's own Stripe/Számlázz.hu/SMTP) | v1 `POST /bookings` returns a Stripe Checkout URL; tBook finalizes, invoices and emails |
| **Products, variants (size/colour), SKUs, prices, VAT, stock** | **tBook** | Inventory API v2 ([inventory-api.md](inventory-api.md)) |
| Product cart, checkout, payment, **invoicing, order tracking, shipping** | **site** | `@sironic/plugin-shop` |
| Counter (on-site) sales of tickets and merch | **tBook** console | Nothing to build; they use the same stock |
| Layout, CMS pages, SEO, admin users | **site** | site layout + `@sironic/cms` / `@sironic/admin` |

The one rule that matters: **for tBook products, the site never keeps its
own stock numbers.** It reads stock from tBook and changes it only through
reservations, sales and returns. tBook enforces "no overselling" across the
site and the counter.

## 3. Tickets: `@sironic/plugin-tbook`

Frontend-only; already ported and working (list, event page, booking
wizard, success page, entry list, tDarts embed). Configure it:

| Env (site) | Value |
|---|---|
| `TBOOK_UPSTREAM_API_BASE` | `https://<tbook-host>/api/v1` (server-side only) |
| `TBOOK_API_KEY` | The **event group's** API key: tBook console → Catalog → Event groups → (group) → API key |

The browser calls the site's own `/api/plugins/t-book/*`. The plugin's proxy
adds the key on the server and forwards only the allowlisted public calls.

**Known gap:** booking several events in one go
(`/foglalas/<id>?events=a,b`, `TBookMultiBookingWizard`) sends multi-event
`entries` bodies, which the new tBook answers with **501**. Single-event
booking works. Don't link to multi-event booking until tBook supports it.

## 4. Products: `@sironic/plugin-shop` + the inventory API

`@sironic/plugin-shop` is a 1:1 port of the main webshop and has its **own**
product, stock and reservation model. To sell tBook products, connect it to
tBook's inventory API. **That is a `sironic-platform` change** (in
`packages/plugins/shop`), done once for all sites, not in a site repo:

1. **Investigate first.** Read the shop's product data layer (`models/Product`, `services/product*`, `services/inventory-reservation*`, `services/checkout-*` and their callers). Find the narrowest seam where products are read and stock is reserved, committed and released.
2. **Add a catalog source.** When `TBOOK_INVENTORY_API_BASE` + `TBOOK_INVENTORY_API_KEY` are set, products and stock come from `GET /products` and `GET /stock`, and the reservation hooks call tBook's `/reservations`, `/commit` and `/release`. Without them, the shop keeps its local catalog. Keep it a clearly separated module (an adapter behind an interface), not `if (tbook)` branches throughout the shop.
3. **Map the fields:**
   - `variants[].sku` is the line item's stable id;
   - `priceGross` / `priceNet` / `vatPercent` are what you charge and invoice;
   - `images[]` are absolute, cache-forever URLs;
   - `description` is sanitized HTML you can render as-is;
   - `variantOptions` drives the size/colour pickers;
   - `label` is a variant's display name.
4. **Checkout:** reserve with the shop's order id as `reference` when checkout starts, using a `ttlSeconds` longer than the payment session. Commit in the Stripe webhook and release on cancel or failure. If a commit gets `409 reservation_not_active`, call `POST /sales` with the same reference (late payment). Refunds that bring goods back call `POST /returns`.
5. **Caching:** cache product lists for a few minutes. Re-check `GET /stock` on the cart page and before checkout.
6. **Invoices and shipping** stay in the shop (its Számlázz.hu, GLS and Foxpost code). tBook doesn't need to know about them.

Tickets and merch are **two separate checkouts** (tickets pay into the tBook
org's Stripe, merch into the site's). A single combined cart isn't supported.

| Env (site) | Value |
|---|---|
| `TBOOK_INVENTORY_API_BASE` | `https://<tbook-host>/api/v2/inventory` |
| `TBOOK_INVENTORY_API_KEY` | tBook console → Settings → Payments & integrations → Inventory API |

All tBook keys are server-side only. Never prefix them with `NEXT_PUBLIC_`.

## 5. tBook-side setup per customer

1. **Organization:** create the customer's organization (tBook console → Organizations, system admin) or reuse one. Set Stripe, Számlázz.hu (+ receipt paper), SMTP and the booking email under Settings.
2. **Group key:** create an event group and its API key, which becomes `TBOOK_API_KEY`.
3. **Inventory key:** if the site sells merch, create the inventory key, which becomes `TBOOK_INVENTORY_API_KEY`.
4. **CORS:** add the site's domain to `TBOOK_API_CORS_ORIGINS`. The proxy doesn't need it, but PDF downloads and the tDarts embed do.

## 6. Before you call it done

- **Tickets:** a single-event booking runs end to end against a tBook staging instance: Stripe test mode, one email with ticket and invoice, both PDFs download from the success page.
- **Entry list:** it shows for a team event with "public entry list" on.
- **Stock:** if merch is wired, buying moves stock in tBook (check **Products → Stock history**), and an abandoned checkout releases it.
- **Two channels, one stock:** selling the last unit at the tBook counter makes it unavailable on the site, and vice versa.
- **Secrets:** no tBook key in a client bundle (`grep -r tbk_ .next/static`).
