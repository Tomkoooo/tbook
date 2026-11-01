# Storefront API (v1) — events, quotes, bookings, checkout

The public API a storefront uses to sell **tickets** (and lodging) for one
event group. Products and stock have their own API:
[inventory-api.md](inventory-api.md).

v1 is **byte-compatible with the legacy WordPress-era plugin**. The
webshop-engine's `@wse/plugin-t-book` (in `webshop-engine/packages/plugins/t-book`)
is a working client for all of it. Reuse that plugin instead of writing a
new client.

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
group's events. Like the inventory key, keep it on the server. The webshop
proxies browser calls through `/api/plugins/t-book` on its own origin (see
`TBOOK_UPSTREAM_API_BASE` below).

Errors: `{ "error": "message" }` with an HTTP status. 401 means a missing or
bad key, 404 an unknown or inactive event, 429 a rate limit (quote: 120/min,
bookings: 20/min per client), 501 a multi-event body.

## Endpoints

| Method | Path | Key | Purpose |
|---|---|---|---|
| GET | `/events` | group | Active, listed events of the group: `{ events: [...] }` |
| GET | `/events/{eventId}` | group | One event with everything the booking form needs: pricing, attendee field schema, team rules, hotels/room types, day-pass days and availability |
| POST | `/quote` | group | Price a selection without booking: `{ quote }` |
| POST | `/bookings` | group | Create a pending booking and its Stripe Checkout session: `{ bookingId, totalHuf, checkoutUrl, stripeSessionId, expiresAt }` |
| GET | `/checkout/status?bookingId=&session_id=` | — (the pair is the credential) | Poll after returning from Stripe: `{ status, totalHuf, guests, eventName, vouchersReady, returnBaseUrl }` |
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
  "selections": { "dayPasses": { "2026-11-14": 2 } }
}
```

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
- **`returnBaseUrl`:** where Stripe sends the guest back (your shop's own success page). The `checkout/status` response echoes it.

### After payment

tBook finalizes on Stripe's webhook, or on the first status poll if the
webhook is late. It then issues the tickets and the Számlázz.hu invoice, and
sends **one email** with both attached. Your success page only needs to poll
`/checkout/status` until `status` is `paid`/`confirmed` and `vouchersReady`
is true, then offer the two download links.

## Not supported (yet)

- **Several events in one quote/booking (`entries` array):** answers 501. Book them one at a time.
- **Products:** not part of v1; use the inventory API.
