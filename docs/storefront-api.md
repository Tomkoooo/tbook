# Storefront API (v1) — events, quotes, bookings, checkout

The public API a storefront uses to sell **tickets** (and lodging) for one
event group. Products and stock have their own API:
[inventory-api.md](inventory-api.md).

v1 keeps the legacy plugin's request and response shapes, because
`@sironic/plugin-tbook` (in `sironic-platform/packages/plugins/tbook`) is
built on them. That plugin is the client: use it, don't write a new one.
Building a site: [site-integration-guide.md](site-integration-guide.md).

Code: `apps/web/src/app/api/v1/*/route.ts`. The logic lives in
`packages/services/src/booking-service.ts` (quote, validation) and
`checkout-service.ts` (booking + Stripe checkout).

## Base URL and auth

```
https://<tbook-host>/api/v1/…
https://<tbook-host>/api/plugins/t-book/…   (legacy alias, same handlers)
```

**Event-group API key** in `X-TBook-Api-Key: tbk_…`, or
`Authorization: Bearer tbk_…`. Create or rotate it in the tBook console under
**Catalog → Event groups → (group) → API key**. A key sees only its own
group's events. Like the inventory key, keep it on the server. The site
proxies browser calls through its own `/api/plugins/t-book/*` (env
`TBOOK_UPSTREAM_API_BASE` + `TBOOK_API_KEY`).

Errors: `{ "error": "message" }` with an HTTP status. 401 means a missing or
bad key, 404 an unknown or inactive event, 429 a rate limit (quote: 120/min,
bookings: 20/min per client).

## Endpoints

| Method | Path | Key | Purpose |
|---|---|---|---|
| GET | `/events` | group | Active, listed events of the group: `{ events: [...] }` |
| GET | `/events/{eventId}` | group | One event with everything the booking form needs: pricing, attendee field schema, team rules, hotels/room types, day-pass days and availability |
| GET | `/events/{eventId}/entry-list` | group | Paid teams of a team event with "public entry list" on: `{ eventName, teams: [{ label, members[] }] }`; 404 when the event doesn't publish it |
| POST | `/quote` | group | Price a selection without booking: `{ quote }`. With an `entries` array (several events): `{ lodgingMode, entries: [{ eventId, eventName, quote }], quote }` |
| POST | `/bookings` | group | Create a pending booking and its Stripe Checkout session: `{ bookingId, totalHuf, checkoutUrl, stripeSessionId, expiresAt }`. With an `entries` array: one booking per event, one Stripe session, plus `bookingIds` and `checkoutBundleId` |
| GET | `/checkout/status?bookingId=&session_id=` | — (the pair is the credential) | Poll after returning from Stripe: `{ status, totalHuf, guests, eventName, vouchersReady, returnBaseUrl }`. For a multi-event booking, `totalHuf`, `guests` and `eventName` cover the whole bundle |
| GET | `/bookings/status?bookingId=&session_id=` | group | Legacy alias of the above |
| GET | `/checkout/return?bookingId=&session_id=[&cancelled=1]` | — | Stripe success/cancel URL; nudges finalization, redirects to tBook's `/book/success` |
| GET | `/checkout/vouchers?bookingId=&session_id=` | — | The guest's ticket PDF (rendered on demand) |
| GET | `/checkout/invoice?bookingId=&session_id=` | — | The guest's invoice PDF (fetched from Számlázz.hu on demand; 502 if Számlázz.hu is unreachable) |
| GET | `/directory` | none | Groups opted into the public tBook directory |

### Quote and booking body

`POST /quote` (`QuoteRequest` in `booking-service.ts`):

```json
{
  "eventId": "…",
  "guests": 2,
  "accommodationGuests": 2,
  "teamMemberCount": null,
  "hotelId": null,
  "nights": null,
  "selections": { "dayPasses": { "2026-11-14": 2 } },
  "discountCode": null
}
```

`discountCode` is day-pass events only: one of the event's configured
discount codes (console: event → Tickets → Day pass pricing → On-site
discount codes), applied as a percent-off to every day in the basket. Omit
it or send `null` for full price. An unknown or disabled code is a 400. The
resolved code (or `null`) comes back on the booking as `discountCode`; it
is never listed on `GET /events/{eventId}` — a buyer needs to already know
it.

`POST /bookings` takes the quote fields plus the customer, billing and
attendees (`CreateBookingInput` in `booking-service.ts`, and
`customerSchema`, `billingInfoSchema` and `bookingAttendeeSchema` in
`packages/schemas`):

```json
{
  "eventId": "…",
  "guests": 2,
  "customer": { "name": "Kovács Anna", "email": "anna@example.com", "phone": "+36301234567", "note": "" },
  "billing": { "billingType": "personal", "name": "Kovács Anna", "zip": "1051", "city": "Budapest", "street": "Fő utca 1.", "countryCode": "HU", "taxNumber": "" },
  "attendees": [ { "fields": { "teljes_nev": "Kovács Anna" } }, { "fields": { "teljes_nev": "Kovács Béla" } } ],
  "returnBaseUrl": "https://shop.example.com"
}
```

- **Attendee fields:** the attendee `fields` keys come from the event's `attendeeFieldSchema` (`GET /events/{id}`). For team events, each attendee has `members: [{ fields }]` per `teamMemberFieldSchema`.
- **Validation:** eligibility rules (age, gender, form rules) and capacity are checked on the server. A failed rule is a 400 with a readable message.
- **Seats are held** until `expiresAt`. An unpaid booking expires and frees its seats.
- **`returnBaseUrl`:** your storefront's origin. Stripe sends the guest back to `<returnBaseUrl>/foglalas/siker?bookingId=…&session_id=…` (or `&cancelled=1`), the success page `@sironic/plugin-tbook` serves. The `checkout/status` response echoes it.

### After payment

tBook finalizes on Stripe's webhook, or on the first status poll if the
webhook is late. It then issues the tickets and the Számlázz.hu invoice, and
sends **one email** with both attached. Your success page only needs to poll
`/checkout/status` until `status` is `paid`/`confirmed` and `vouchersReady`
is true, then offer the two download links.

### Several events in one booking

`@sironic/plugin-tbook` uses this for `/foglalas/<id>?events=a,b`
(`TBookMultiBookingWizard`). Send an `entries` array instead of a single
`eventId` (`MultiQuoteRequest` / `CreateMultiBookingInput` in
`multi-booking-service.ts`):

```json
{
  "lodgingMode": "combined",
  "entries": [
    { "eventId": "…", "guests": 2, "teamMemberCount": null, "attendees": [ … ] },
    { "eventId": "…", "guests": 1 }
  ],
  "hotelId": "…", "nights": 2, "selections": { … }, "accommodationGuests": 2,
  "customer": { … }, "billing": { … }, "returnBaseUrl": "https://shop.example.com"
}
```

- **Lodging:** `combined` (default) books one stay from the top-level `hotelId`/`nights`/`selections`/`accommodationGuests`, priced on the first entry; the other entries are entry-only. `separate` takes those fields from each entry.
- **Rules:** 1–20 entries, each event once, all in the key's group and in the same currency. Each entry is checked exactly like a single booking.
- **All or nothing:** if any entry fails (sold out, eligibility, …) or Stripe can't open the session, no seats stay reserved.
- **One payment, separate bookings:** each event gets its own booking (own tickets, invoice and email), linked by `checkoutBundleId`. The return URL and `bookingId` point at the first booking; `checkout/status` reports the bundle's total.

## Not supported (yet)

- **Products:** not part of v1; use the inventory API.
