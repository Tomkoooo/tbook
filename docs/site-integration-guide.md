# Building a site on tBook (sironic-platform) — guide for agents

Read this before building a customer site that sells tBook tickets and/or
tBook products. It says **where the code goes**, **which system owns what**,
and **which API to call for each job**.

## 1. Where the code goes

Three places, each with its own job:

| Place | What lives there | Who changes it |
|---|---|---|
| `~/programing/tbook` (this repo) | The central backend: events, bookings, tickets, products & stock, invoices/receipts, console | Backend work only |
| `~/programing/sironic-platform` | Shared `@sironic/*` packages: `core`, `ui`, `cms`, `auth`, `admin`, `sdk`, `cli`, `plugin-shop`, `plugin-tbook`, `plugin-tbook-shop` | Anything reusable across sites |
| `<customer>-site` (its **own repo**) | One customer's site: layout, content, plugin config, generated route stubs | Site-specific work |

A new site is **its own repository**, created from the template that ships
in `@sironic/cli` (`sironic-platform/packages/cli/template`):

```bash
cd ~/programing/sironic-platform
node scripts/pack.mjs <vendor-dir>                    # package tarballs (until the npm scope is published)
npx sironic create-site <customer>-site --vendor <vendor-dir> --plugins tbook-shop,tbook   # or shop,tbook without tBook merch
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
| Product cart, checkout, payment, **invoicing, order tracking, shipping** | **site** | `@sironic/plugin-tbook-shop` (the shop, wired to tBook's catalog and stock) |
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

Booking several events in one go (`/foglalas/<id>?events=a,b`,
`TBookMultiBookingWizard`) works too: one Stripe payment, a booking per
event (see "Several events in one booking" in
[storefront-api.md](storefront-api.md)). Stripe returns buyers to the
site's `/foglalas/siker`, which the plugin serves.

## 4. Products: `@sironic/plugin-tbook-shop`

To sell tBook merch, put `tbookShopPlugin()` in `site.config.ts` **instead of**
`shopPlugin()`, next to `tbookPlugin()`:

```ts
plugins: [adminPlugin(), tbookShopPlugin(), tbookPlugin({ look: "default" })]
```

(`npx sironic create-site <dir> --plugins tbook-shop,tbook`, or
`npx sironic add-plugin tbook-shop`.) It is the full `@sironic/plugin-shop`
(cart, checkout, Stripe, order admin, Számlázz.hu, GLS/Foxpost), but
products, prices and stock come from tBook's inventory API. Nothing about
this goes in the site repo. The code is in
`sironic-platform/packages/plugins/tbook-shop` (see its README):

- **Catalog:** tBook products are copied into the shop's product collection (`external.source = "tbook"`), so the shop pages work unchanged. The copy refreshes in the background when it is older than 10 minutes, on `POST /api/tbook-shop/sync` (shop admin), or from a cron `GET /api/tbook-shop/sync` with `Authorization: Bearer $TBOOK_SHOP_SYNC_SECRET`.
- **Stock:** reserve when Stripe checkout starts (reference `shop-<tempOrderId>`), commit when paid (`POST /sales` if the hold lapsed), release on cancel or expiry, `POST /returns` on refund. Stock is re-read (`GET /stock`) on the cart page and before checkout.
- **Fields:** variant `sku` identifies the line; `priceGross`/`priceNet`/`vatPercent` are what the shop charges and invoices; `images`, sanitized `description`, `variantOptions` and variant `options` drive the product page.
- **Edit products in tBook** (console → Products). Shop admin edits to tBook products are overwritten on the next sync. A product that doesn't come from tBook can't be sold in this mode.
- **Invoices and shipping** stay in the shop. tBook doesn't need to know about them.

The plain `shopPlugin()` (without tBook) keeps its own catalog and stock;
use it only for sites that don't sell tBook merch.

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

- **Tickets:** a single-event and a multi-event (`?events=a,b`) booking run end to end against a tBook staging instance: Stripe test mode, one email with ticket and invoice, both PDFs download from the success page.
- **Entry list:** it shows for a team event with "public entry list" on.
- **Stock:** if merch is wired, buying moves stock in tBook (check **Products → Stock history**), and an abandoned checkout releases it.
- **Two channels, one stock:** selling the last unit at the tBook counter makes it unavailable on the site, and vice versa.
- **Secrets:** no tBook key in a client bundle (`grep -r tbk_ .next/static`).
