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
bookings: 20/min per client). Added: `code`, a machine-readable reason when
there is one — e.g. `capacity_full`, `sales_closed`, `on_waitlist`,
`bus_full`, `not_full`, `duplicate`, `duplicate_field`, `validation_error`.
Messages that reach guests (registration, waitlist, guest self-service,
surveys) are Hungarian, informal ("te"); a failed form rule returns the
organizer's own rule message.

**Preview mode (for site developers).** Send the group's preview key in
`X-TBook-Preview: tbp_…` next to the API key (console: **Catalog → Event
groups → (group) → Preview key**, or `tbook-cli group keys`). With a valid
key:

- `GET /events/{id}` and `POST /events/{id}/prefill` also work on a
  **draft** event and outside the sales window; `GET /events/{id}` adds
  `preview: true`.
- `POST /bookings` runs every check (fields, rules, `in_list`, unique IDs,
  waitlisted IDs, capacity, bus seats) but saves, reserves and sends
  nothing: `{ ok, preview: true, status: "confirmed", registrationNumber:
  "PREVIEW-7K3M", bookingId: null, totalHuf }` (`status` is `"payment"` for
  a paid booking). Multi-event `entries` aren't supported in preview (400).
- `POST /waitlist/join` runs every check and returns `{ ok, preview: true,
  entryId: null, position }`, the position it would get. The event must
  still be full (409 `not_full` otherwise).

A missing or wrong preview key is not an error: the request is handled
normally (a draft event is a 404).

**Test bookings (for the client to try the real flow before go-live).**
Send `X-TBook-Test: 1` **together with a valid** `X-TBook-Preview` key. Without
a valid preview key the header is ignored (a normal request). With it:

- `POST /bookings` (single event, free registration) runs the **real**
  booking path — also on a **draft** event and outside the sales window —
  and saves a **test booking**: the normal response plus `test: true`
  (`{ ok, bookingId, totalHuf: 0, checkoutUrl, stripeSessionId: "", expiresAt,
  status: "confirmed", registrationNumber, test: true }`). A booking that
  would need payment is refused (400 `test_payment_unsupported`); `entries`
  (multi-event) stay unsupported (400).
- `POST /waitlist/join` saves a **test waitlist entry**: `{ ok, entryId,
  position, test: true }`. Test entries are their own queue: `position`
  counts test entries only, and there is no `not_full` check.
- Every email the normal flow sends is really sent for test records —
  confirmation (with QR), bus details, waitlist joined / promoted / offer,
  cancellation, bus-seat-freed notice — with the subject prefixed
  **`[TESZT] `**, to the test record's own addresses only.
- Test records are **kept apart from live data**: they take no event
  capacity (`remainingPlaces`, `salesState`, `capacity_full`, `waitlistOpen`
  never change) and no bus seats; their unique answers (employee ID) live in
  a separate namespace, so a test ID never blocks a live registration and
  vice versa (an ID is unique among tests and among live guests separately).
  A cancelled test guest moves only the test waitlist (auto mode: the first
  test entry is registered as a test booking; one place per cancelled test
  guest) and notifies only test guests on the bus waitlist; live
  cancellations never promote or notify test records. Test records are left
  out of console statistics, reports, exports, check-in lists (a test ticket
  is refused at the door) and the public entry list; the console's booking
  list shows them with a **TESZT** badge.
- **Visibility:** any request with the valid preview key sees test records
  — `/guest/lookup|update|cancel`, `/waitlist/status|leave`,
  `/surveys/{id}/responses` search test registrations first, then live ones;
  answers for a test record add `test: true` (`guest.test` in lookup/update,
  top-level in cancel, status, leave and survey responses). Requests
  without the preview key never see test records (404 / "not found"), and
  these guest endpoints need the preview key on a draft event.
  `POST /events/{id}/prefill` with `X-TBook-Test: 1` reports
  `alreadyRegistered` / `onWaitlist` among test records.
- Clean up with `tbook-cli booking purge-test --org <org> --event <id>`
  (dry run lists what would go; `--apply --prod-ack --confirm PURGE`
  deletes test bookings, tickets, ID claims, bus waitlist places, email log
  rows, test waitlist entries and test survey answers — no emails, no live
  counter changes).

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
| POST | `/events/{eventId}/prefill` | group | "Start with your ID": `{ code }` → `{ found, alreadyRegistered, fields }`, the answers to start the form with. See below |
| POST | `/guest/lookup` | group | Guest self-service (module `guest-portal`): find a registration by `{ eventId, code }`, where `code` is the registration number or the identifying answer (e.g. employee ID). See below |
| POST | `/guest/update` | group | `{ eventId, code, fields }`: change the guest's own answers |
| POST | `/guest/cancel` | group | `{ eventId, code, reason? }`: cancel this guest (free registrations only) |
| POST | `/waitlist/join` | group | Module `waitlist`: `{ eventId, guests?, customer, attendees, returnBaseUrl? }` with the same answers as a booking: `{ entryId, position }`, and emails the "joined" notice with the position. 409 `not_full` while places are left, 409 `duplicate` when the email or an ID is already waiting, 409 `duplicate_field` when an ID is already registered |
| POST | `/waitlist/status` | group | `{ eventId, code }` (any identifying answer, e.g. employee ID, of anyone in an open entry) → `{ entry: { status, position, guests, names, createdAt, offerExpiresAt } }`; 404 when none. 20/min |
| POST | `/waitlist/leave` | group | `{ eventId, code }` → `{ left: true }`: the entry is removed, a held place goes to the next in line. 404 when none. 10/min |
| GET | `/surveys?eventId=` | group | Module `feedback`: the event's open surveys `{ surveys: [{ id, title, intro, questions, ratingMax }] }` |
| POST | `/surveys/{surveyId}/responses` | group | `{ code \| token, answers: { questionId: value } }`: once per guest (409 `already_answered`), stored without identity |

`GET /events/{eventId}` also returns these added fields:

- `waitlistOpen`: the event is full and takes waitlist entries.
- `registrationPrefill`: `{ fieldKey, label, helpText }` when the form starts with an ID lookup, otherwise `null`.
- `remainingPlaces`: `capacity − places taken − places held` (held = unpaid checkouts and open waitlist offers), never below 0; `null` when the event has no cap.
- `salesState`: `"not_started"`, `"on_sale"` or `"closed"` (the sales window, as booking checks it).
- `preview: true`: only in preview mode.

### Waitlist (module `waitlist`)

- **When:** `waitlistOpen` is true, or a booking failed with `code: "capacity_full"` (a group bigger than `remainingPlaces` is refused for booking and can join instead). Join with the same body as a booking.
- **Position** everywhere = the entry's rank among `waiting` entries in joining order, `1` = next in line. A group entry counts once. While a place is offered to an entry (offer mode) its `status` is `offered`, `position` is `null` and `offerExpiresAt` is set.
- **Statuses:** `waiting`, `offered` (open); `registered`, `expired`, `declined`, `failed`, `removed` (closed — `status`/`leave` then 404).
- **IDs are held:** while an entry is open, its identifying answers (employee ID) can't book (`POST /bookings` → 409 `on_waitlist`) or join again; `prefill` returns `{ found: true, alreadyRegistered: false, onWaitlist: true, fields: {} }`. Send those guests to the waitlist status page.
- **Promotion:** when a place frees up (guest or console cancel, expired checkout), the first entry that fits moves up. Auto mode (free events): registered at once; they get the "Bekerültél" email and the event's normal confirmation with the QR code. If their chosen bus has filled up meanwhile they are registered with `busz = "waitlist"` (see below) and the email says so. Offer mode: an email link holds the place for `offerHours`.
- **Cancellation email:** with module `guest-portal` on, a cancelled guest (by themselves or by an organizer) gets a short confirmation email. Its text, like the waitlist and bus-seat emails, is edited on the console's Emails page as a system email (`booking_cancelled`); switched off there, nothing is sent. The old module settings `cancelSubject` / `cancelMessage` still apply when the event has no such email.

### Two bus states: no buses yet / bus booking open

The organizer switches between them on the console's Buses page; the site reads the state from `GET /events/{eventId}` and needs no change of its own:

- **No active bus yet** ("bus booking not open"): the bus question (`choicesSource: "bus-transport:routes"`) comes with `required: false`, `choices: []` and `fieldChoiceDetails.busz: []` — no buses and no `"waitlist"` option. Guests answer only the transfer question; an empty bus answer is valid (booking, preview, test booking, `/waitlist/join`, `/guest/update`). A `"waitlist"` (or any other) bus answer is refused with 400 `validation_error`, like any answer not offered. Hide the bus question when `choices` is empty.
- **At least one active bus**: as before — the bus question is `required` (when shown), its choices are the buses plus `"waitlist"`. Guests registered earlier with "transfer: yes" add their bus to the same registration with `POST /guest/update` (`fields: { busz: "<routeId>" }`): registration number, QR code and ticket stay. While the bus question is required, a guest who wants a transfer must pick a bus (or `"waitlist"`) with their next change; the other guests of a group are not held to it.
- `{{bus.transfer}}` in emails: "Foglalt" (bus booked), "Várólistán (értesítünk)" (bus waitlist), "Igényelt (járat még nincs kiválasztva)" (bus question shown, i.e. transfer wanted, but no bus yet), otherwise "Nem igényelt".
- Emails: after a change (`/guest/update` or an organizer edit) an automatic email goes to that guest again only if they match its conditions now **and** a question its conditions look at changed, or their email address changed (an email without conditions: only on an address change). Picking a bus, or switching bus, therefore sends the bus email (conditions e.g. `busz is_not_empty` and `busz not_equals "waitlist"`), not the general confirmation.

### Multi-stop buses (added 2026-11-14)

A bus can have several pickup stops sharing its seats (e.g. "Szombathely–Győr–Tatabánya", 50 seats: 13:30 Szombathely, 15:00 Győr, 16:00 Tatabánya). The bus question then offers **one choice per stop**:

```json
{
  "value": "665f…a1~1",
  "label": "Győr – Puskás Tivadar utca 37., indulás 15:00 (Szombathely–Győr–Tatabánya, B01)",
  "remaining": 12,
  "disabled": false,
  "meta": { "code": "B01", "routeName": "Szombathely–Győr–Tatabánya", "stopIndex": 1, "city": "Győr", "pickupPoint": "Puskás Tivadar utca 37.", "departure": "2026. december 4. 15:00", "departureAt": "2026-12-04T14:00:00.000Z", "returnInfo": "…" }
}
```

- **Value**: `"<routeId>~<stopIndex>"` (0-based, in departure order). Send it back unchanged in `fields.busz` (booking, `/guest/update`, `/waitlist/join`). A bus without stops keeps the plain `"<routeId>"` value, label `"<city> – <pickup point> (<code>), <HH:MM>"` and its meta (plus `routeName`). A plain `"<routeId>"` stored before a bus got stops stays valid while the guest leaves it unchanged.
- **Seats** are the bus's: every stop shows the same `remaining`, and all stops of a full bus are `disabled` together (a full bus is a 400, as before). Moving to another stop of the same bus never fails for lack of seats.
- `meta.city` / `pickupPoint` / `departure` are the stop's; `meta.routeName` is the bus's name (its own city field).
- In `/guest/lookup` the `bus` object gives the guest's stop as `city` / `pickupPoint` / `departureAt` / `departure`, plus `routeName` and `stopIndex` (null for a bus without stops). Emails: `{{bus.city}}`, `{{bus.pickupPoint}}`, `{{bus.departure}}` are the guest's stop, `{{bus.routeName}}` the bus's name.

### Bus waitlist ("értesítést kérek")

While at least one bus is active, a select fed by the bus module (`choicesSource: "bus-transport:routes"`) always accepts the value `"waitlist"`, listed last in both `attendeeFieldSchema[].choices` and `fieldChoiceDetails`:

```json
{ "value": "waitlist", "label": "Nincs szabad hely – értesítést kérek, ha felszabadul", "remaining": null, "disabled": false, "meta": { "waitlist": true } }
```

It holds no seat and satisfies "required". Those guests wait in line (first come first served by when they chose it). When seats free up (a cancellation, an edit or expiry releasing a seat, a new or re-activated bus, more seats) everyone in line gets one email (bus module settings `busWaitlistSubject` / `busWaitlistMessage`, with `{{name}}`, `{{event}}`, `{{siteUrl}}`); again only after new seats free up, or 6 hours later. They pick a real bus with `POST /guest/update` (`fields: { busz: "<routeId>" }`); a full bus is a 400 `bus_full`. They're not on passenger lists or captain views; the console's Buses page and the bus export list them. In emails `{{bus.transfer}}` reads "Várólistán (értesítünk)".

### Start with the ID (prefill)

When `registrationPrefill` is set, the form's first step asks only for that question (e.g. employee ID):

1. Send it to `POST /events/{eventId}/prefill` with `{ "code": "12345" }`.
2. Handle the response:
   - `found: true`: show the whole form, filled with `fields`. Every answer stays editable, and the identifying answer is in `fields` too.
   - `found: false`: the ID isn't on the list, so the guest can't continue (the registration rule would refuse it anyway).
   - `alreadyRegistered: true`: no data comes back. Send the guest to self-service (`/guest/lookup`).
   - `onWaitlist: true` (added): the ID waits on the waitlist; `fields` is empty. Send the guest to the waitlist status (`/waitlist/status`).
3. Register with `POST /bookings` as usual. Every check runs again on the server.

Organizers set this up in the form builder. They mark the ID question "Identifies the guest", put an "is in list" rule on it, and choose a "Prefill from data list column" for each other question. A list cell fills a dropdown only when it matches an option's value or label.

This endpoint returns a person's details for an ID, so it allows 30 calls per client per minute. Have the site forward the guest's IP (`X-Forwarded-For`) so the limit applies per guest and not to the site as a whole.

### Guest self-service

Rate-limited per client. The lookup returns `{ guest }`:

- `registrationNumber`, `name`, `fields` (answers; email and phone are masked — unless the event's guest-portal module setting `showContactUnmasked` is `"yes"`: then they come in full and their `form[]` entries have `masked: false`);
- `form`: every question with live options and `editable` (identifying questions and the module's locked questions are never editable; nothing is editable once the event has started);
- `bus`: `{ code, city, pickupPoint, departureAt, departure, routeName, stopIndex, returnInfo, captainName, captainPhone }` (city / pickup / departure = the guest's stop on a multi-stop bus), or `null`;
- `transferRules`: the bus module's rules text (e.g. the 15-minute wait rule);
- `busWaitlist`: `{ position }` (1 = next) when the guest asked to be notified about a bus seat, otherwise `null`;
- `canEdit`, `canCancel`.

An update is checked like a registration (required answers, rules, unique ID, bus seats). Automatic emails are sent again only where the change matters: the guest matches the email's conditions now and a question those conditions look at changed, or the guest's email address changed (see "Two bus states" above). In a group registration, cancel removes only that guest; the record is kept and listed as cancelled.

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
