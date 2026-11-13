# Plan: module system + Hálózatok Ünnepe 2026 requirements

Source: *Hálózatok Ünnepe 2026 – Vendégkezelő app és landing fejlesztési brief v0.2*.
Event: 4 Dec 2026, BOK Csarnok. Registration opens **16 Nov** (closes 24 Nov 16:00 or at 1,300 guests).
Today is 9 Nov, so registration opens in 7 days. The phasing at the end follows from that date.

---

## 1. What the brief asks for vs. what tBook already has

| # | Brief requirement | Today in tBook | Gap |
|---|---|---|---|
| 1 | Free registration, shared 1,300 cap, a fixed window | `capacity`, `salesOpensAt/ClosesAt` on Event. Storefront bookings always go through Stripe; only the console can record `comp` | **Free (zero-price) registration flow** |
| 2 | Form: name, employee ID (törzsszám), employer, email, phone, bus need + city, dinner, dietary needs | **Form builder** (`registration-fields-editor.tsx`: text/email/phone/number/date/select, group defaults + event extend/replace) | Builder extensions: `checkbox` type, conditional fields (city only when a bus is wanted). See section 2.6 |
| 3 | Required privacy-consent box, format checks, **duplicate filtering** | **Rule engine** (`eligibility.ts` + `rules-editor.tsx`): `regex`, `in`, `min`/`max`, age, and/or | Format checks work today via `regex` rules. Missing: required checkbox (consent) and a `unique` field flag (dedupe) |
| 3b | (Client clarification) Only real employees may register: the employee ID is checked against a **full ID list** or a **regex** | `regex` rule exists; `in` takes a comma-separated list (fine for 10 values, not for thousands); rules are one flat and/or list | Rule engine extensions: **nested rule groups** (a regex per employer) and an **`in_list` operator** backed by uploaded value lists |
| 4 | Several participants per email; a group leader manages colleagues | One booking = one customer + N attendees, one voucher each | Mostly there. **Stable attendee IDs** are missing (voucher `attendeeIndex` is positional) |
| 5 | Unique QR in confirmation email, phone or print | Voucher token + PDF email | Done. Maybe show the QR inline in the email body |
| 6 | Hostess: phone camera scan → employee ID → name search; instant status; ≤1 confirm tap; parallel points; duplicate warning | Scan panel (camera, keyboard wedge, manual code), `lookup` vs `check_in` mode, `duplicate` result | **Lookup by employee ID and by name**, mobile-first one-tap UI, live counters, "checked in at 18:42 by X" on duplicates |
| 7 | Correct a wrong check-in, with permission | `revertCheckInAsAdmin` | **Audit trail**, permission gate |
| 8 | Offline / weak connection fallback | None | **Offline mode** (see M5) |
| 9 | Searchable guest list: name, ID, employer, reg. status, arrival, **VIP**, **bus** | Booking list + check-in roster (voucher based) | **Attendee-centric list with field filters**, VIP tag, bus filter |
| 10 | Counts: registered / arrived / expected, per bus | Roster status totals | Per-bus counts (bus module) |
| 11 | Bus captain: own route roster, add anyone, outbound and return boarding marked separately, separate from venue entry | None | **Whole bus module** |
| 12 | Roles admin / organizer / hostess / captain, all read; writes only admin + senior organizer; audit of key changes and check-ins | Custom RBAC roles per org | **Role templates**, **audit log** |
| 13 | Guest self-service: see QR, edit, cancel | None (only post-checkout voucher download) | **Guest self-service API**: the guest identifies with their **employee ID or the registration number** the system generates. No login, no portal account (M3) |
| 14 | Two-step bus booking: need + city first, then a concrete route chosen by free seats; departure info shown to the guest | None | Bus module |
| 15 | Organizers email info and reminders to guest segments | Transactional emails only | **Broadcast / campaign module** |
| 16 | General info page for guests | None | Info content blocks served by the guest API (M3) |
| 17 | Anonymous satisfaction survey from 5 Dec, reachable **on the site (by ID or registration number) and by email** | None | **Survey module** with an email invitation channel |
| 18 | Anonymous 4–5 point ratings at stations (fortune tellers, casino, catering) on a kiosk tablet, stored apart from guest profiles | None | **Kiosk ratings** |
| 19 | Photo gallery + download | — | **Out of scope for tBook**: built into the landing page |
| 20 | Daily Excel export + final report (attendees, bus, meals, ratings) | CSV booking export on demand; no scheduler (and none planned) | **On-demand** KPIs, charts, filters and xlsx export instead of scheduled reports (C5) |
| 21 | Editable, mobile-first landing at halozatokunnepe2026.hu | Built on sironic-platform per `docs/site-integration-guide.md` | Outside this repo. tBook provides the APIs |
| 22 | One guest record ties registration, QR, bus, edits, check-in | Booking + vouchers | Use the stable attendee ID as the anchor every module references |

---

## 2. Architecture: modules, not hardcoded branches

### Why now
The codebase already shows the drift this would cause: `"day_pass"` is branched on in **14 files**
(schemas, 5 services, 6 console pages). tDarts and SumUp are ad-hoc `settings.x.enabled` booleans,
and `AFTER_BOOKING_PAID_HOOKS` is an untyped array that each service pushes into at import time.
Bolting buses, surveys, VIP lists and kiosks on the same way would put event-specific `if`s everywhere.

### Principles
1. **Compile-time plugins, runtime flags.** Modules are code in the repo, bundled and type-checked.
   No dynamic code loading. What changes at runtime is *where* a module is turned on and its config.
2. **Core never imports a module.** Modules import core (`@tbook/schemas`, `db`, `services`, `domain`).
   Core exposes **hooks** (lifecycle events) and **slots** (UI extension points) that modules fill.
3. **Each module owns its data**: its own collections, keyed by `organizationId` + `eventId` + `attendeeId`.
   It does not add fields to `Booking`/`Event`, apart from the shared `modules` config map.
4. **Disabled means invisible**: nav entries hidden, routes 404, hooks skipped, API endpoints 404.
5. **Everything is still scoped by `organizationId`.** The registry adds no new way to cross tenants.
6. **Extend the existing engines, never build a parallel one.** Registration data is defined by the form builder and
   validated by the rule engine (section 2.6). Modules add field types, field flags, rule operators and rule fields to
   those engines. They do not ship their own validators, question builders or filter languages.

### 2.1 Module manifest (`packages/modules/<key>/manifest.ts`)

```ts
export const busTransportModule = defineModule({
  key: "bus-transport",
  name: "Bus transport",
  description: "Routes, seat assignment, captain rosters, boarding.",
  scopes: ["org", "group", "event"],          // where it can be switched on
  dependsOn: [],
  config: {                                    // zod schema per scope, merged org → group → event
    org: z.object({}),
    event: busEventConfigSchema,               // e.g. demandFieldKey, cityFieldKey (picked from the form builder's fields), choiceOpensAt
  },
  permissions: ["bus:read", "bus:manage", "bus:board"] as const,
  roleTemplates: [{ name: "Bus captain", permissions: ["bus:read", "bus:board", "voucher:scan", "booking:read"] }],
  hooks: {
    "booking.cancelled": releaseSeats,
    "attendee.updated": syncDemand,
  },
  ruleFields: [busRouteRuleField],            // `$busRoute` usable in rules, segments, filters (section 2.6)
  kpis: [busKpis],                             // dashboard widgets + charts, see C5
  exportSheets: [busExportSheet],              // extra sheets in the xlsx export, see C5
});
```

`packages/modules/src/registry.ts` lists every module, so it is statically importable and type-safe.
Module permissions are folded into `TBOOK_PERMISSIONS` from the registry at build time, so
`permissionSchema` stays a closed enum.

### 2.2 Storage and resolution

```ts
// On Organization, EventGroup and Event (same shape on each)
modules: Record<ModuleKey, { enabled: boolean; config?: unknown; changedBy: ObjectId; changedAt: Date }>
```

- **Org level is the entitlement.** Only a **system admin** sets it. Without it the module does not exist for that org.
- **Group / event level** narrows it: `effective = org.enabled && (event ?? group ?? manifest.defaultOn)`.
  **Decided:** org admins toggle and configure modules at group/event level through a new `module:manage`
  permission (in `permissions.ts` + `permission-labels.ts`, falling back to `event:write` for roles saved
  before it existed), and only inside the system admin's org entitlement. System admins can do it too.
- **Config** is deep-merged org → group → event and validated by the manifest's zod schema on save.
- `resolveModules({ organizationId, groupId?, eventId? })` returns `{ isOn(key), config(key) }`.
  It is cached per request and is the only way code asks "is X on?".
- Guards: `requireModule(key, scope)` in server actions and route handlers, called beside `requireOrgPermission`.

### 2.3 Core extension points

| Extension point | Replaces / generalises | Used by |
|---|---|---|
| **Lifecycle bus** `emit("booking.paid", …)`: `booking.created/confirmed/paid/updated/cancelled`, `attendee.updated`, `voucher.checked_in/reverted` | `AFTER_BOOKING_PAID_HOOKS` and the scattered `dispatchWebhookEvent` calls | bus, waitlist, broadcast, webhooks, tDarts |
| **Rule fields**: virtual fields a module exposes to the rule engine (`$busRoute`, `$tag`, `$checkedIn`) | — | segments (M7), guest list and dashboard filters (C5, C9) |
| **Scan resolvers** turn raw input into candidate vouchers | `parseVoucherTokenFromScan` only | fields flagged `identifier` (F3), registration number (C6), name search (C8) |
| **Scan decorators** add badges to a scan result | — | VIP (M6), bus info (M4) |
| **Roster columns / filters** | hardcoded roster | VIP, bus, employer |
| **UI slots**: admin nav, event-form section, booking-detail panel | hardcoded pages | every module with UI |
| **Guest API extensions**: a module registers its guest endpoints and its entry in the `steps` response (M3) | — | bus choice (M4), survey (M8) |
| **KPI widgets, charts, filters, export sheets** | the CSV export | bus counts (M4), tags (M6), ratings and survey results (M8) |

UI slots are a typed registry in `apps/web/src/modules/registry.ts` that maps a slot name to React
components. Module pages are real route folders under `app/(admin)/admin/(modules)/<key>/`, each with
a `layout.tsx` that calls `requireModule`. Next.js cannot register routes dynamically, so modules keep real folders.

### 2.4 Folder layout

```
packages/modules/
  src/registry.ts, define-module.ts, resolve.ts, hooks.ts
  bus-transport/
    manifest.ts
    schemas.ts        # zod
    model.ts          # mongoose collections owned by the module
    domain.ts         # pure logic, unit tested
    service.ts        # orchestration, integration tested
apps/web/src/modules/bus-transport/   # components for slots
apps/web/src/app/(admin)/admin/(modules)/bus/…   # module pages
apps/web/src/app/api/v2/modules/bus/…            # module API
```

The `domain → db → services` layering rules from AGENTS.md apply inside each module.

### 2.5 System admin UI
- `/admin/organizations/[orgId]/modules`: entitlement toggles, org-level config, dependency warnings.
- A **Modules** tab on the group and event edit pages: toggles and config forms inside the entitlement.
- Each change goes to the audit log (C4).

### 2.6 Registration: one form builder, one rule engine

tBook already has both halves:
- **Form builder**: attendee field defs (`attendeeFieldDefSchema`), edited in `registration-fields-editor.tsx`, with
  group-level defaults and event-level extend/replace (`resolveEventAttendeeFieldSchema`). Per-field type checks live in
  `booking-validation.ts` (`validateAttendees`).
- **Rule engine**: `eligibility.ts` (`validateEligibility`, ops `equals/not_equals/in/not_in/contains/regex/min/max/min_age/max_age` (+ `in_list/not_in_list/is_empty/is_not_empty` since),
  `and`/`or`), edited in `rules-editor.tsx`, stored as `event.eligibilityFormRules`, reported as `form_rules_failed` with
  the organizer's own message per rule.

Every registration requirement in the brief is met by extending these two, not by new validators:

| ID | Extension | What it gives | Brief need |
|---|---|---|---|
| **F1** | New field types: `checkbox` (required means it must be ticked), `textarea`, `rating` (1–N scale) | Consent box; long text; survey and kiosk scales (M8) | consent, dietary needs, ratings |
| **F2** | Conditional fields: `showWhen: { fieldKey, values }` on a field def, the same shape as `optionDef.dependsOn`. A hidden field is neither required nor stored | Ask the city only when a bus is wanted | bus need + city |
| **F3** | Field flags: `unique` (one active registration per value per event, or per group) with `normalize` (trim, case, strip spaces/leading zeros); `identifier` (a guest can identify with this value) | Dedupe on employee ID; the same field drives guest lookup (M3), door search (C8) and guest list search (C9) | duplicate filtering, ID-based access |
| **F4** | Nested rule groups: `{ logic, rules: (Rule \| Group)[] }`. Existing flat configs read as one group, so stored events keep working | "employer is A **and** ID matches `^A\d{6}$`" **or** "employer is B **and** ID matches …" | regex per employer |
| **F5** | **Value lists** + `in_list` / `not_in_list` operators. A value list is a named, org-owned list uploaded as CSV/xlsx (normalised, indexed, re-uploadable with a diff of registered values that dropped off). The service resolves membership of the submitted values before calling the pure domain function, so `@tbook/domain` stays I/O-free | The full-ID-list mode, if a list ever arrives, and any other "must be one of these 5,000" rule | ID list |
| **F6** | Rule fields from modules (section 2.3): `$status`, `$checkedIn`, `$tag`, `$busRoute`, … | The same rule config, edited in the same `rules-editor.tsx`, becomes a **segment** (M7) or a **filter** (C5, C9) | email segments, searchable guest list |

How the pieces apply:
- **`unique`** is enforced in the service with a claimed-values collection that has a unique index on
  `(eventId, fieldKey, normalisedValue)`, so two concurrent registrations can't both claim an ID. The claim is released on
  cancel. Waitlisted attendees keep their claim.
- **The ID gate for this event** is plain configuration: an `employee_id` text field flagged `unique` + `identifier`, an
  `employer` select, and an F4 rule group with one regex per employer. If a full list arrives, swap the regex rules for
  an F5 `in_list` rule. No code change.
- **Guest-facing messages** come from the rule's own `message` field, as today. For unique clashes the event config can
  use one generic message, so the form can't be used to probe which IDs exist.
- **The same validation runs everywhere**: storefront registration (M1), admin manual booking, guest edits and a group
  leader adding a colleague (M3), and waitlist promotion (M9). It is one function in one place.
- **The UI is reused**, not copied. `registration-fields-editor.tsx` also edits survey and kiosk questions (M8).
  `rules-editor.tsx` also edits segments (M7) and saved filters (C9). Both move to `apps/web/src/components/` so modules
  can import them.

---

## 3. Work items

### Core platform (generic infrastructure, not modules)

| ID | Item | Notes |
|---|---|---|
| **C1** | Module registry, `modules` map on org/group/event, resolver, `requireModule`, system-admin UI | Foundation for everything else |
| **C2** | Typed lifecycle bus | Migrate the three existing `AFTER_BOOKING_PAID_HOOKS` users (email, tDarts, webhooks) and the `dispatchWebhookEvent` call sites onto it |
| **C3** | UI slot registry + `(modules)` route group with guarded layouts | |
| **C4** | **Audit log** collection: actor, org, entity, action, before/after diff, timestamp. Written for check-in, revert, booking edit/cancel, role changes, module toggles. Console viewer. | The brief requires it and every tenant benefits, so it belongs in core |
| **C5** | **Reporting and analytics** (replaces the scheduled reports idea): event dashboard with KPI tiles (registered / arrived / expected, cancellations, registrations per day, arrivals per 15 min), charts, the same filter as C9 (rule engine shape, F6), and an **xlsx export** of exactly the filtered view (via `exceljs`, streamed, no file on disk). Modules add KPI widgets, filters and extra sheets through C3. Meal and dietary counts come from aggregating the configured attendee fields. | No cron: everything is computed on demand. Time-based behaviour (survey opens 5 Dec, bus choice opens) is a date check at request time, not a job |
| **C6** | **Stable attendee IDs** (`attendee.id`, uuid) + migration script + `voucher.attendeeId`. **Registration numbers**: a short, human-friendly, non-sequential code per attendee (e.g. `HU26-7K3M9Q`, 8 chars of Crockford base32, unique per event) and one per booking for the group leader. Printed in the confirmation email and on the ticket PDF; it also works as a typed code at the door. | Every module refers to a guest by `attendeeId`, never by index. Guests use the registration number (or their employee ID) to identify themselves |
| **C7** | Module permissions + role templates ("Hostess", "Organizer", "Senior organizer", "Bus captain") offered when a module is enabled | Follow the permission-fallback rule in AGENTS.md |
| **F1–F6** | Form builder and rule engine extensions (section 2.6) | Generic, available to every tenant; F5 value lists can be gated by a flag if wanted |
| **C8** | Check-in improvements every tenant gets: **name search**, lookup by any `identifier` field (F3) or registration number, live counters (polling or SSE), duplicate result shows when and by whom, mobile layout of the scan page | Extends existing `scanVoucher` / `listCheckInRosterForOrg` |
| **C9** | Attendee-centric guest list: one row per attendee, quick search over `identifier` fields and name, advanced filters written in the rule engine shape (F6) and savable; columns extensible via C3 | Fixes the "searchable guest list" gap generically |

### Modules

| ID | Module key | Scope | What it does |
|---|---|---|---|
| **M1** | `free-registration` | event | Zero-price bookings skip Stripe and invoicing and go straight to `confirmed` + vouchers + email. `paymentMethod: "comp"`. Uses the existing capacity and sales window. Needs a v1 extension (`/bookings` returns `confirmed` instead of a checkout URL). Validation is the existing path: field checks, eligibility rules, `unique` claims (section 2.6). Rate-limited, captcha optional. When the event is full and M9 is on, the booking becomes `waitlisted` instead of being refused. |
| ~~M2~~ | ~~`attendee-registry`~~ | — | **Dropped.** Everything it did is now configuration on the existing form builder and rule engine: the ID gate (F4 regex groups / F5 value lists), dedupe (F3 `unique`), door lookup and guest identification (F3 `identifier`). |
| **M3** | `guest-self-service` | event | **API only**, rendered by the third-party site as in previous deployments (via `@sironic/plugin-tbook`); tBook serves no guest pages. New endpoints beside v1, v1 shapes unchanged, called with the site's existing group API key. **No login, no one-time codes**: each call carries `{ eventId, identifier }`, where `identifier` is any value of a field flagged `identifier` (F3, here the employee ID) or a **registration number** (C6). An attendee registration number or employee ID reaches that attendee; the booking-level number reaches the whole booking, so the group leader can act for colleagues. **Endpoints:** `POST /guest/lookup` (registration, statuses, QR tokens + ticket PDF link), `PATCH /guest/attendee` (fields the event marks guest-editable; re-validated with the same fields and rules), `POST /guest/attendees` (group leader adds a colleague; same field and rule validation as registration), `POST /guest/cancel` (one attendee, or the whole booking with the booking number), `POST /guest/info` (info content blocks), `POST /guest/steps` (registration → bus choice → event day → feedback; each step listed only when its module is on and its date has come). Modules add their own endpoints through the same identifier check (M4 bus choice, M8 survey). **Edits and cancels are never deletes**: a cancelled attendee stays listed as *cancelled* (voucher voided, capacity freed, M9 promotes the next waitlisted guest), and an edited one shows *edited*, with the change in the audit log (C4). No deadline by default, since the brief sets none; optional `editClosesAt` in config. **Guarding without friction:** an employee ID is often known to colleagues, so (a) email and phone come back masked (`t***@example.com`) in lookups; (b) every edit or cancel triggers a notification email to the registered address with the registration number, so a wrongful change is noticed and an organizer can reinstate it; (c) per-IP and per-identifier rate limits, and the same "not found" response for unknown and cancelled identifiers. Documented in a new `docs/guest-api.md`. CORS uses the existing `TBOOK_API_CORS_ORIGINS`. |
| **M4** | `bus-transport` | event | **Routes** (city, pickup point, departure/return times, capacity, captain user). **Phase 1, demand**: reads the bus-need + city attendee fields. **Phase 2, choice**: after `choiceOpensAt` the guest picks a route with free seats on the site (atomic seat counter, same pattern as day-pass capacity); organizers can auto-assign leftovers. Guest-side choice goes through the guest API (`GET /guest/bus/routes`, `POST /guest/bus/choice`). **Captain view**: opens on the captain's own (current) route roster; a search box and a route switcher let them find any guest and open other routes' lists (read access to everyone, not row-level restriction). They can add any guest as a passenger and mark **outbound** and **return** boarding separately. Boarding is stored apart from venue check-in. Per-route counts on the dashboard. The guest API returns the assigned route and times. |
| **M5** | `offline-check-in` | event | PWA (manifest + service worker) for the scan page. Caches the roster as `tokenHash → name, ID, status, VIP` for read-only verification while offline. Queues check-ins in IndexedDB and syncs on reconnect: server applies first-wins by device timestamp and reports conflicts. Clear online/offline indicator. Last resort: a printable alphabetical list (PDF rendered on demand). |
| **M6** | `guest-tags` | org / event | Org-defined tags (VIP, Press, Staff, …) with colours; bulk import from CSV matched on an `identifier` field or email; VIP badge in scan results and the roster; exposes `$tag` as a rule field (F6) for segments and filters. Changes audited. |
| **M7** | `broadcast-email` | event | A **segment is a rule config** edited in the shared `rules-editor.tsx`, over attendee fields plus module rule fields (`$tag`, `$busRoute`, `$checkedIn`, F6). No separate segment language. Templates with merge fields (name, QR link, route, registration number, link to the site). Sent when the organizer presses send (no scheduler), throttled in batches through the org's SMTP, with a per-recipient send log so a stopped send can resume. Preview + test send. M8 uses it for survey invitations. |
| **M8** | `feedback` | event | (a) **Kiosk ratings**: stations (fortune tellers, casino, catering), each with a kiosk URL carrying a station token, one `rating` field (F1, 4 or 5 points), full-screen tablet UI, auto-reset, rate-limited. No login. (b) **Anonymous survey**: questions are **field defs edited in the shared form builder** (`rating`, `select`, `textarea`, F1), and optional questions can use `showWhen` (F2), `opensAt` (5 Dec) and `closesAt`. **Two ways in:** on the site, where the guest enters their employee ID or registration number (via the M3 guest API), or from an **email invitation** sent to a segment via M7 (e.g. everyone checked in), which carries a personal one-time link. **Anonymity:** responses go to a separate collection with no guest reference. One-response-per-guest is enforced with an HMAC "has responded" marker kept in a different collection, and timestamps are coarsened, so responses can't be re-linked to guests. Results feed C5 (charts, xlsx sheet). |
| **M9** | `waitlist` | event | When the event is full (1,300), a registration that passes field and rule validation is stored as **`waitlisted`**: a new booking status (`waitlisted → confirmed | cancelled`), no voucher, its own confirmation email saying "you're on the waitlist, position N". Waitlisted attendees keep their `unique` claims (F3), so the same ID can't register twice. On every `booking.cancelled` / attendee cancel (C2 hook), the freed places go to the front of the queue, in one of two **promotion modes** set per event: **`auto`**: the first waitlisted attendees that fit are confirmed at once, vouchers are issued and the standard confirmation email with QR goes out, with a line saying they moved up from the waitlist. **`offer`**: the first in line gets an email offering the place, with a deadline (`offerHours`, e.g. 24 h). They accept through the guest API with their employee ID or registration number (`POST /guest/waitlist/accept`, M3), or decline. The place is held for them meanwhile. When the offer expires or is declined, it passes to the next person. **Without cron**, expiry is checked whenever the event is touched (any registration, cancel, guest lookup, or an organizer opening the waitlist view): expired offers are swept and passed on in that request. Organizers also get a "pass to next" button. **Settings** (in the event's module config): mode, `offerHours`, `promoteUntil` (after it, cancellations only free capacity and nobody is promoted), whole booking vs per attendee, and the email texts (org email template overrides, `waitlistJoined` / `waitlistPromoted` / `waitlistOffer`). Editable by org admins and event managers (`module:manage`, which falls back to `event:write`). Organizers see the queue in C9 and can promote or remove by hand; waitlist size is a C5 KPI. Group bookings are promoted whole only if all members fit (configurable: whole booking or per attendee). Note: `waitlisted` is a new value in the v1 status enum; add it without renaming anything, and update the sironic plugin to show it. |

Catering (dinner, dietary needs) **is not a module**. It is ordinary attendee fields, and C5 aggregates them.
The 4 member companies sharing a cap need no new feature: one event with `capacity: 1300` and
employer as a select field.

### Outside this repo (landing on sironic-platform)
- Registration form using v1 + the M1 free-registration response, with the new fields and consent.
- Public read endpoints: bus routes/cities (M4) and event info. Add these as new endpoints rather than changing v1 shapes.
- The guest self-service screens (lookup by ID or registration number, edit, cancel, steps, bus choice, survey) on top of the M3 guest API.
- **Photo gallery and downloads** live entirely on the landing page, not in tBook.
- Informal second-person ("tegeződő") copy: a content concern, but the tBook email templates and guest API messages need the same tone (org-level email template overrides already exist).

### Later: move existing features onto the module system
After the event, once the pattern has proven itself: `tdarts` (org settings flag + paid hook), `sumup`,
`pos`, `hotels`, `products/inventory`, and `day_pass` (the 14-file branch: it becomes a module owning
the event `kind` extension). This shrinks core and lets system admins turn features on per tenant.

---

## 4. Phasing against the dates

| Phase | Deadline | Scope |
|---|---|---|
| **0: registration opens** | **15 Nov** | C1 (minimal: org/event flags + resolver + system-admin toggle; group level and config UI can follow), C6, M1, F1 `checkbox`, F2 conditional fields, F3 `unique` + `identifier`, F4 nested rule groups (**the ID gate for this event is regex rules per employer, no code of its own**), M9 waitlist (capture only; promotion can follow in phase 1), plus the event set up with fields incl. bus need + city. Landing form live. Confirmation email with QR and registration number. **Blocker: the client must deliver the ID regex(es) per employer before 15 Nov.** |
| **1: during registration** | 24 Nov | F5 value lists (ready if a list arrives), F6 rule fields, C2, C4, C7 roles, M3 guest self-service API (lookup/edit/cancel by ID or registration number, group leader), M9 promotion on cancel (`auto` and `offer` modes), M6 VIP, C9 guest list, C5 first cut (KPIs + filtered xlsx export), M7 broadcast (reminders) |
| **2: before the event** | 1 Dec (dry run 2 Dec) | M4 bus (choice opens after registration closes; captain view), C8 check-in (ID/name search, live counts), M5 offline, C5 charts + bus/meal sheets, M8 kiosk ratings, load test: 1,300 guests and ~10 parallel scanners |
| **3: after the event** | from 5 Dec | M8 survey live (site + email invitation), ratings/survey charts and export, thank-you content |
| **4: hardening** | Jan | Migrate tDarts/SumUp/day-pass onto modules; group-level config UI polish |

Phase 0 keeps bus demand as plain form-builder fields (`bus_need`, and `bus_city` with `showWhen`). M4 later
points at them through its config (`demandFieldKey`, `cityFieldKey`), so no data migration is needed and the
bus module does not block registration opening.

---

## 5. Decisions

**Decided (client/owner, 9 Nov):**
1. **Group/event module toggles:** org admins, through the `module:manage` permission, inside the system admin's org entitlement (section 2.2).
2. **Guest self-service:** API only, rendered by the third-party site as in previous deployments (M3).
3. **Gallery:** on the third-party site, not part of tBook.
4. **Offline check-in:** PWA cache + queued sync + printed list, as proposed (M5).
5. **Captain scope:** defaults to their current route; can search everyone and open other routes (M4).
6. **Edits, cancels, retention:** the brief sets no deadline or retention, so guests can edit and cancel, and nothing is deleted. Records stay, marked *cancelled* or *edited*, with history in the audit log.

7. **Guest identification:** no login, no one-time codes, no portal account. A guest acts on their registration by giving their **employee ID or the system-generated registration number** (M3). Mitigations that add no friction: masked contact details, rate limits, and a notification email on every change.
8. **ID gate:** no full list exists. Both modes are prepared as rule engine extensions (F4 regex groups now, F5 value lists in phase 1). This event runs on regex rules; switching to a list is a config change.
9. **Waitlist:** yes. Once the 1,300 cap is reached, registrations go to a waitlist and are promoted automatically when someone cancels (M9).
10. **No parallel engines:** registration, dedupe, the ID gate, survey questions, segments and filters all use the existing form builder and rule engine (section 2.6).

11. **Waitlist promotion:** configurable per event by the org admin or event manager: auto-advance with notification, or an email offer to the first in line that passes on if not accepted in time. Promotion runs until a configurable `promoteUntil`, so it can continue after registration closes (M9).

**Still open:** nothing blocking design. The one external dependency is the client's ID format per employer before 15 Nov.

---

## Implementation status (2026-11-11)

Changes since the plan above, following the client's detailed spec (6 emails, group registration, bus at registration, captain lists, check-in order):

- **Bus is chosen at registration** (not two-step): a `busz` dropdown fed by the bus module (`choicesSource: "bus-transport:routes"`), shown only when `transzfer = igen`, with atomic seat reservation. Released on cancel/expiry.
- **Captains see only their own bus**: a per-route secret link (`/captain/<token>`), no login. Outbound and return boarding are tracked separately, with search, live counts and an admin view. Export per bus or all buses as xlsx.
- **Emails** (module `event-emails`): automatic per attendee on registration (optionally conditional, e.g. only bus passengers), or manual Send to registered guests, everyone on a data list, or list rows not registered yet. Each send has a test, progress, stop/resume and a delivery log with errors. No cron.
- **Check-in**: QR → registration number (typed into the same field) → name search with one-tap Check in. Live counts and an arrivals xlsx.
- **Data lists + import wizard** (`/admin/data`): any spreadsheet becomes an org data list (`in_list` rules, email audiences) or feeds a module import target (e.g. bus routes).
- **Module switches**: system admin grants per organization (Organizations page); per event on the event page (`module:manage`). Module settings (e.g. site/survey/gallery links) are declared by the module.
- **Setup from a plan file**: `tbook-cli setup apply --plan docs/plans/halozatok-unnepe-2026.setup.json` (dry run by default).
- **Bug fixed along the way**: eligibility rules were never enforced on booking creation (the Mongoose document was spread, losing its fields). Regression test added.

Production (tbook-admin, org eventstructure), created as **draft** on 2026-11-11: group `6af44de468da08303fcf0618`, event `6af44de468da08303fcf0619`, data list "DSO dolgozói lista" (3088 rows), 6 emails. Restore point: `backups/cli/setup-apply-6af44de468da08303fcf0619-…`.

Built after that (same day):

- **Edits and cancellations**: organizer and guest edits keep each guest's registration number, re-check the form and rules, and move unique IDs and bus seats (all or nothing). One guest of a group can be cancelled; the record moves to "cancelled guests". Every change is logged on the booking (Change history).
- **Guest self-service** (module `guest-portal`): `POST /api/v1/guest/lookup|update|cancel` by registration number or ID. Returns bus, captain name and phone, and the bus module's transfer rules (new setting; also `{{bus.rules}}` in emails).
- **Tags** (VIP, …): per guest on the booking page; bulk via the import wizard ("Guest tags", matched by ID; IDs not registered yet are tagged when they register). Shown on scan, filterable on the check-in roster.
- **Waitlist** (module `waitlist`): `POST /api/v1/waitlist/join`; offer mode (email link `/waitlist/<token>`, place held for N hours) or auto mode (free events). Console: Guests → Waitlist.
- **Feedback** (module `feedback`): surveys (once per guest via `{{feedbackUrl}}` or code; anonymous answers) and kiosk ratings (`/kiosk/<token>`). Results with bars and xlsx export.
- **Reports** (`/admin/reports`): headline counts, answer breakdowns with a one-answer filter, registrations per day, full xlsx export (cancelled guests on a second sheet).
- **Multi-event bookings** confirm free entries without Stripe.

Still open: bus route data (none received), site/survey/gallery URLs and the transfer rules text, switching on `guest-portal`/`waitlist`/`feedback` for the event, deploy.

### 2026-11-12: contract for the event site (plain PHP, server-side v1 calls)

- **Preview mode:** a per-group preview key (console next to the API key; `tbook-cli group keys --rotate-preview / --reveal-preview`). Header `X-TBook-Preview` makes draft events readable (GET event, prefill) and turns `POST /bookings` and `POST /waitlist/join` into dry runs: every check, nothing saved or sent (`registrationNumber: "PREVIEW-XXXX"`, `bookingId: null` / `entryId: null` + would-be position). A wrong key = normal request.
- **GET /events/{id}:** `remainingPlaces`, `salesState` (`not_started` / `on_sale` / `closed`), `preview`.
- **Errors** carry a `code` (e.g. `capacity_full`, `on_waitlist`, `bus_full`); guest-facing messages are Hungarian ("te"), a failed form rule returns its own message.
- **Event waitlist:** "joined" email with the position (`joinedSubject` / `joinedMessage`); `POST /waitlist/status` and `/waitlist/leave` by employee ID; an ID on the waitlist can't book (409 `on_waitlist`) and prefill says `onWaitlist: true`. Position = rank among waiting entries, 1 = next. Auto promotion claims the entry atomically (no double promotion across concurrent cancellations) and falls back to the bus waitlist when the stored bus is full (noted in the email). A cancelled guest gets a cancellation email (guest-portal `cancelSubject` / `cancelMessage`).
- **Bus waitlist:** the bus select always offers `"waitlist"` ("Nincs szabad hely – értesítést kérek, ha felszabadul"): no seat, FIFO line, one email per newly freed seats (or after 6 h) with the bus module's `busWaitlistSubject` / `busWaitlistMessage`; the guest then picks a bus with `POST /guest/update`. Lookup returns `busWaitlist: { position }`; `{{bus.transfer}}` = "Várólistán (értesítünk)". Not on passenger lists; listed on the Buses page and in the export.
- **Setup:** `setup apply --update` syncs an existing event's module grants, module switches/settings and emails with the plan (never its own fields). The plan now switches on `guest-portal`, `waitlist` (auto) and `feedback`, sets `siteUrl`, and email 1 carries the site password.
- Tests: `apps/web/src/app/api/v1/capacity-waitlist.integration.test.ts` (1,300 through real bookings, waitlist, promotion, bus waitlist, preview, held IDs) and the CLI `setup --update` / `group keys` cases.

### 2026-11-13: test bookings (`X-TBook-Test: 1`)

- Header `X-TBook-Test: 1`, honoured only with a valid `X-TBook-Preview` key (`requireApiKeyGroup` → `{ groupId, preview, test }`). `POST /bookings` (single event, free) and `POST /waitlist/join` then run the real path, also on a draft event, and save records with `isTest: true`; responses add `test: true`. All emails go out with "[TESZT] " subjects (`sendMail({ test })`).
- Isolation from live data: no event capacity / day passes / bus seats; unique claims stored as `test:<fieldKey>` (same unique index, own namespace); waitlist entries in a separate queue (test promotion only on test cancellations, one place per cancelled test guest); bus waitlist test line notified only by test cancellations; no invoice, tDarts or outbound webhook for test bookings; test tickets refused at check-in.
- Hidden from live: guest/waitlist/survey endpoints find test records only with the preview key; console statistics, reports, exports, check-in lists, passenger lists, manual/“not registered” email audiences and the public entry list exclude them; bookings list and waitlist page show a TESZT badge.
- Cleanup: `tbook-cli booking purge-test --org eventstructure --event <id>` (dry run; `--apply --prod-ack --confirm PURGE`, restore point under `backups/cli/`).
- Tests: `apps/web/src/app/api/v1/test-bookings.integration.test.ts`.

### 2026-11-13: two bus states (no buses yet / bus booking open)

- **Switch = the Buses page**: no active bus → state 1 "bus booking not open yet"; activate (or import) at least one bus → state 2. No development, no special-casing of the event.
- **State 1**: the bus question (`choicesSource: "bus-transport:routes"`) offers no choices at all (not even `"waitlist"`) and is not required, even if marked required and shown (booking, preview, test booking, waitlist join, guest/organizer edit). Mechanism: the bus choice provider sets `optionalWhenEmpty`; `resolveFieldChoices` relaxes `required` when a provider yields nothing. A `"waitlist"` answer is refused (400 `validation_error`) like any answer not offered. Bookings still store the organizer's `required`.
- **State 2**: unchanged — the bus is required when shown, choices = buses + `"waitlist"`. State-1 guests add a bus with `POST /guest/update` (same registration number, QR, ticket). An edit only re-checks the guests it changes, so one guest of a group can pick a bus before the others. A waitlist entry from state 1 promoted in state 2 goes on the bus waitlist (`busz = "waitlist"`); a `"waitlist"` answer promoted while no bus is active is dropped.
- **`{{bus.transfer}}`**: "Foglalt" (bus booked) / "Várólistán (értesítünk)" / "Igényelt (járat még nincs kiválasztva)" (bus question shown, no bus) / "Nem igényelt".
- **Emails after an edit** (guest or organizer, via the `onAttendeesEdited` hook): an `on_registration` email goes again to that guest only if they match its conditions now and a question its conditions reference changed, or the guest's address changed; an email without conditions only on an address change. Picking or switching a bus sends the bus email, not the general confirmation. The console's "resend confirmation" still re-sends everything.
- **Condition ops** `is_empty` / `is_not_empty` (no value) in the rule engine, email conditions and registration rules editors. Bus booked: `busz is_not_empty` AND `busz not_equals "waitlist"`; transfer wanted, no bus yet: `transzfer equals "igen"` AND `busz is_empty`. Unknown ops in email conditions are refused (they used to match everyone).
- Tests: `apps/web/src/app/api/v1/bus-two-state.integration.test.ts`, `packages/domain/src/eligibility.test.ts`.

### 2026-11-13: system emails on the Emails page

Every email the system sends a guest of the event is now listed on the console's Emails page and editable as a template.

- **System triggers** (event email model, next to `on_registration` / `manual`): `waitlist_joined` (joined the waitlist; `{{position}}`), `waitlist_offer` (offer mode: place held; `{{link}}`, `{{hours}}`), `waitlist_registered` (auto mode: registered from the waitlist; `{{registrationNumber}}`, `{{busNote}}` — the "your bus was full" note, appended at the end if the template doesn't place it, its paragraph dropped when empty), `bus_seat_freed` (bus waitlist: a seat freed up), `booking_cancelled` (guest or organizer cancel, one per cancelled guest; no QR). All of them also take the usual `{{firstName}}`, `{{fullName}}`, `{{siteUrl}}`, `{{event…}}`, `{{field.*}}` answers, plus the old `{{name}}` / `{{event}}`; the attendee ones (`bus_seat_freed`, `booking_cancelled`) also `{{registrationNumber}}` and the module values (`{{bus.*}}`). At most one email per system trigger and event; no audience, conditions or Send button (test send only, with sample values for `{{position}}`, `{{link}}`, …).
- **Precedence:** the event's email of the trigger (active → it is sent; **inactive → nothing is sent**) > the module settings text (waitlist `joined/offer/registered Subject/Message`, bus `busWaitlistSubject/Message`, guest-portal `cancelSubject/Message` — deprecated, hidden in the module settings while empty, kept as a fallback) > the built-in Hungarian text. Templates apply only while event emails is on for the event. Recipients unchanged: waitlist emails go to the entry's contact address, bus/cancellation emails to each affected attendee. Test records keep the `[TESZT] ` subject. Sends are logged in the email's delivery log.
- **Console:** the Emails page has a "System emails" section with a row per message of the modules on for the event (label, when it is sent, built-in / module settings text / custom / off, sent/failed counts); "Customise" opens a new template prefilled with the text sent today. The waitlist row not used in the current mode is marked.
- **Left as they are:** the default booking confirmation (org-level; replaced per event by an active `on_registration` email), the console's ticket re-send, and staff/org mails (sign-in link, SMTP test). The feedback module sends no emails (survey links go in manual emails via `{{surveyUrl}}`).
- **Plan:** `halozatok-unnepe-2026.setup.json` has R1–R4 (joined, auto-registered, bus seat freed, cancellation); the offer email isn't needed in auto mode. The CLI accepts the system triggers (unknown triggers and a second email of a system trigger are refused; `--update` matches a system email by trigger too).
- Tests: `packages/modules/src/event-emails/system-emails.integration.test.ts`, `scripts/tbook-cli/setup.integration.test.ts`.
