# Building a site on tBook with webshop-engine — guide for agents

Read this before building a storefront or webshop that sells tBook tickets
and/or tBook products. It says **where the code goes**, **which system owns
what**, and **which API to call for each job**.

## 1. Where the code goes

Build sites **inside the webshop-engine monorepo**, not as a new standalone
project. webshop-engine is one repo with shared engine packages and one thin
app per site:

```
webshop-engine/
  packages/core, admin, sdk, …        engine (shared, don't fork)
  packages/templates/<id>             look & feel (one per design)
  packages/plugins/t-book             tBook tickets client (exists)
  packages/plugins/shop               cart / checkout / orders / shipping (exists)
  apps/<site>/                        ← the new site lives here
```

Steps (see `webshop-engine/README.md` § "Create a new customer site" and
`webshop-engine/AGENTS.md`):

1. **Read** `webshop-engine/AGENTS.md`, `docs/plugins/AI_AGENTS_PLUGIN_GUIDE.md` and `docs/templates/AI_AGENTS_TEMPLATE_GUIDE.md`.
2. **Scaffold:** `npm run create-site -- --name <site> --template <template> --plugins shop,t-book`. This creates `apps/<site>/`.
3. **Design:** if the site needs its own design (e.g. it recreates a site the owner gave you as a reference folder), create a **template** package with the template guide. Don't put design code into the engine or the site app.
4. **Docker:** register the app in the Dockerfile deps stage (README step 2).

The reference site you are given (a downloaded copy of the current site) is
**design and content input**: layout, copy and images. Port its look into a
template and its content into the CMS (`docs/cms/AGENT_CONTENT_IMPORT.md`).
Don't copy its code or its data model.

## 2. Who owns what

| Concern | Owner | How the webshop gets it |
|---|---|---|
| Events, ticket prices, capacity, attendee forms, ticket PDFs, door check-in | **tBook** | Storefront API v1 through `@wse/plugin-t-book` — [storefront-api.md](storefront-api.md) |
| Ticket payment, ticket invoices, ticket emails | **tBook** | v1 `POST /bookings` returns a Stripe Checkout URL; tBook finalizes, invoices and emails |
| **Products, variants (size/colour), SKUs, prices, VAT, stock** | **tBook** | Inventory API — [inventory-api.md](inventory-api.md) |
| Product cart, checkout, payment, **invoicing, order tracking, shipping** | **webshop** | `shop` plugin (Stripe, Számlázz.hu, GLS/Foxpost already exist there) |
| Counter (on-site) sales of tickets and merch | **tBook** console | Nothing to build; they use the same stock |
| Site design, CMS pages, SEO | **webshop** | template + CMS |

The one rule that matters: **the webshop never keeps its own stock numbers
for tBook products.** It reads stock from tBook and changes it only through
reservations, sales and returns. tBook enforces "no overselling" across the
webshop and the counter.

## 3. Tickets: reuse the t-book plugin

- **Config:** set `TBOOK_UPSTREAM_API_BASE=https://<tbook-host>/api/v1` and the event group's API key in the plugin's settings. Browser calls go to the site's own `/api/plugins/t-book/*`, which proxies to tBook, so the key stays on the server.
- **Booking flow:** event list → event page → booking form built from the event's `attendeeFieldSchema` → `POST /bookings` → redirect to `checkoutUrl` → success page polls `/checkout/status` → download links.
- **Don't** create or store bookings in the webshop database. tBook is the record.

## 4. Products: connect the shop plugin to the inventory API

webshop-engine's `shop` plugin has its own `Product` model (variants, stock,
reservations). For tBook products, **tBook's catalog replaces it as the
source of truth**:

1. **Investigate first.** Read the shop plugin's product data layer (`packages/core/src/models/Product.ts`, `services/inventory-reservation.ts` and their callers) and find the narrowest seam where products are read and stock is reserved, committed and released.
2. **Add an adapter at that seam.** When a site is configured with a tBook inventory key (`TBOOK_INVENTORY_API_BASE`, `TBOOK_INVENTORY_API_KEY`), products and stock come from `GET /products` and `GET /stock`, and the shop's reservation hooks call tBook's `/reservations`, `/commit` and `/release`. Sites without the key keep today's local catalog. Make it a plugin or a clearly separated module, following the plugin guide; don't scatter `if (tbook)` branches through the engine.
3. **Map the fields:**
   - `variants[].sku` is the line item's stable id;
   - `priceGross` / `priceNet` / `vatPercent` are what you charge and invoice;
   - `images[]` are absolute URLs (cacheable forever);
   - `description` is sanitized HTML you can render as-is;
   - `variantOptions` drives the size/colour pickers;
   - `label` is the display name of a variant.
4. **Checkout:** reserve with the shop's order id as `reference` when checkout starts, using a `ttlSeconds` longer than the payment session. Commit in the payment webhook and release on cancel or failure. If a commit gets `409 reservation_not_active`, call `POST /sales` with the same reference (late payment). Refunds that bring goods back call `POST /returns`.
5. **Caching:** cache product lists for a few minutes. Don't cache stock for long; re-check `GET /stock` on the cart page and before checkout.
6. **Invoices and shipping** stay entirely in the webshop (its Számlázz.hu and GLS integrations). tBook doesn't need to know about them.

Mixed cart (tickets and merch in one payment) isn't supported: tickets pay
through tBook's checkout, merch through the shop's. Present them as two
checkouts, or ask the owner before designing anything else.

## 5. Environment (site app)

| Variable | Purpose |
|---|---|
| `TBOOK_UPSTREAM_API_BASE` | `https://<tbook-host>/api/v1`, for tickets (t-book plugin) |
| tBook event-group key | Plugin settings (admin), for tickets |
| `TBOOK_INVENTORY_API_BASE` | `https://<tbook-host>/api/v2/inventory`, for products and stock |
| `TBOOK_INVENTORY_API_KEY` | tBook console → Settings → Payments & integrations → Inventory API |

Keys are server-side only. Never prefix them with `NEXT_PUBLIC_`.

## 6. Before you call it done

- **Tickets:** a test booking runs end to end against a tBook staging instance: Stripe test mode, ticket and invoice email, the PDFs download.
- **Stock:** buying a product moves stock in tBook (check **Products → Stock history**), and an abandoned checkout releases it.
- **Two channels, one stock:** selling the last unit at the tBook counter makes it unavailable in the shop, and vice versa.
- **Secrets:** no tBook key in a client bundle (`grep` the `.next` output for `tbk_`).
