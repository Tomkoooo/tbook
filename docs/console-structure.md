# Console structure

The console is organised the way the business is: an **organization** has
**event groups**, a group has **events**. The URL says where you are, the shell
shows it, and the tools you see are the ones that exist for that event or group
(module on, permission held).

```
Organization                                   /admin/…
 ├─ Event group  (owns hotels, API keys)       /admin/groups/[groupId]/…
 │    └─ Event   (owns day-of operations)      /admin/events/[eventId]/…
```

## Where things live

| Scope | Route | What |
|---|---|---|
| Org | `/admin` | Dashboard |
| Org | `/admin/events`, `/admin/groups` | The catalog: lists, create |
| Org | `/admin/bookings`, `/admin/bookings/[bookingId]` | All bookings across events (Bookings / Attendees views); a booking's detail (a booking knows its event) |
| Org | `/admin/reports` | Reports hub: every event with its registrations report, attendee list and stand daily reports |
| Org | `/admin/products`, `/admin/merch` | Merch catalog + stock (shared with the webshop) and the merch register |
| Org | `/admin/data/…` | Name lists (eligibility, VIP, email audiences) |
| Org | `/admin/members`, `/admin/settings/…`, `/admin/integrations` | Team, settings, payments, webhooks |
| Org | `/admin/organizations` | Platform (system admin): organizations and module entitlements |
| Station pickers | `/admin/check-in`, `/admin/sales`, `/admin/stand` | "Which event?" for door / counter / stand staff — today's events first |
| Group | `/admin/groups/[groupId]` | Group overview, API/preview keys, module switches |
| Group | `/admin/groups/[groupId]/events` | The group's events and the tools on for each |
| Group | `/admin/groups/[groupId]/hotels`, `…/hotels/[hotelId]` | Hotels (a hotel belongs to a group, shared by its events) |
| Event | `/admin/events/[eventId]` | Overview, settings, module switches |
| Event | `…/bookings`, `…/bookings/new` | Bookings and attendees of this event (`?view=attendees`); register someone paid outside the storefront |
| Event | `…/check-in` | Door scanner and arrivals |
| Event | `…/sales` | Counter point of sale for tickets |
| Event | `…/stand`, `…/stand/products`, `…/stand/safe`, `…/stand/stats`, `…/stand/export` | Stand mode |
| Event | `…/bus`, `…/bus/[routeId]` (+ `export`) | Bus transfer |
| Event | `…/waitlist`, `…/emails`, `…/emails/[emailId]` | Waitlist, event emails |
| Event | `…/feedback`, `…/feedback/new`, `…/feedback/[surveyId]`, `…/kiosk`, `…/kiosk/[surveyId]` | Surveys and kiosks |
| Event | `…/vip`, `…/reports`, `…/preview` | VIP list, reports, dry-run of the guest-facing screens |

Build links with `lib/event-routes.ts` (`eventPath`, `groupPath`). **Never use
`?eventId=`** for a tool; filters (`view`, `from`, `to`, status…) stay in the query.

## Old URLs

Old URLs keep working through `legacyRedirects` in `apps/web/next.config.ts` (temporary, 307 — make
them permanent once nothing links to the old paths). The query is kept except `eventId`/`groupId`,
which move into the path.

| Old | New |
|---|---|
| `/admin/<tool>?eventId=X` (+ sub-pages) for bookings, check-in, sales, stand, bus, waitlist, feedback, kiosk, emails, vip, reports, preview | `/admin/events/X/<tool>[/…]` |
| `/admin/bookings/new?eventId=X` | `/admin/events/X/bookings/new` (without `eventId`: `/admin/events`) |
| `/admin/check-in/X` (+ `/export`) | `/admin/events/X/check-in[/export]` |
| `/admin/hotels?groupId=G`, `/admin/hotels/H?groupId=G` | `/admin/groups/G/hotels`, `/admin/groups/G/hotels/H` (`/admin/hotels` alone: `/admin/groups`) |
| `/admin/sales/merch[/…]` | `/admin/merch[/…]` |
| `/admin/<tool>` without `eventId` (bus, waitlist, feedback, kiosk, emails, vip, reports, preview) | `/admin/events` |

**Not redirected:** the station pickers `/admin/check-in`, `/admin/sales`, `/admin/stand` without
`eventId` stay as "which event?" pages. **Unresolvable old detail links** (a record id and no event
in the URL, so no static rule can find the event): `/admin/bus/[routeId]`,
`/admin/feedback/[surveyId]`, `/admin/kiosk/[surveyId]`, `/admin/emails/[emailId]`,
`/admin/hotels/[hotelId]` without `?groupId=`. They 404 now (the pages moved under the event/group).

## The shell

- **Sidebar** (`admin-nav.tsx`, data in `lib/nav-config.ts`): *Home* (Home, Help), *Events*
  (Events, Event groups), *Organization* (Bookings = all events, Products, Merch register, Data
  lists, Team, Settings), *Stations* (Check-in, Point of sale, Stand — the entry for door / counter /
  stand staff who only hold `event:read`; they pick an event). Every item is filtered by module +
  permission (`filterNavGroups`). When the path is inside an event or group, a **contextual
  section** comes first: titled with the event's name, "← All events", Overview and that
  event's tools (or the group's).
- **One registry, one filter.** `lib/event-tools.ts` (`EVENT_TOOLS`, `GROUP_TOOLS`,
  `filterEventTools`, `filterGroupTools`, `eventToolLinks`) feeds the event tabs, the sidebar's
  contextual section, the ⌘K palette and the home page, so they can't disagree. Data lists are an org
  tool (not an event tool); hotels are a group tool.
- **Event workspace** (`events/[eventId]/layout.tsx`, server): `requireEvent`, a header (name, status,
  dates, group link), an event switcher (`switchEventInPath` — keeps the tool) and tabs for the tools
  that are on for *this event* and open to this member. The overview tab is the event page (settings,
  module switches; an empty state when no tool is on). `/admin/events/new` skips the workspace.
- **Group workspace** (`groups/[groupId]/layout.tsx`): header + tabs Overview, Hotels (module
  `hotels`, `hotel:read`), Events (`/admin/groups/[id]/events`).
- **How the shell learns the workspace:** the layouts render `<WorkspaceHeader>` which publishes
  `{ kind, id, name, links }` through `components/shell/workspace-store.tsx` (`WorkspaceRegistrar`,
  `useWorkspace`). Sidebar section, breadcrumbs and palette read it, so the name never needs a second
  fetch; before it registers (first paint) they fall back to the 30 s cached
  `loadShellEntitiesAction` (`use-shell-entities.ts`) and show a skeleton, never "Details".
- **Breadcrumbs** (`lib/crumbs.ts` → `buildCrumbs`): Events › Event name › Bus › Details; groups
  likewise; org pages Home › Page.
- **⌘K palette:** pages, the current workspace's tools, events and groups by name, and — once you type
  two characters — every event's tools as "Bus — Event name" (capped at 30).
- **`EventPicker`** (`components/event-picker.tsx`) is path-aware: inside `/admin/events/<id>/…` it
  switches with `switchEventInPath`; elsewhere (station pickers) it keeps `?eventId=`. Pages inside the
  workspace don't need it — the workspace header has the switcher.

## Entry for staff

`/` is a real home page. Signed out: sign-in and a note for bus captains / kiosks (they use the
link they were sent). Signed in: the organization, **today's events**, and the shortcuts this
person's role can use (door, counter, stand, bus, kiosk) deep-linked into the event, plus a link
to the admin console. The installed app starts at `/`.

## Design tokens

Follow the tCrm template (`docs/06-design-tokenek.md` there): oklch zinc neutrals, brand =
`--primary` / `--secondary` (+ dark `--sidebar-primary`), radius 0.625rem, a dedicated
`--sidebar-*` set, status tones (meaning, not brand), dark mode = `.dark` class via `next-themes`.

## Lists: the DataTable engine

Every list view uses `components/data-table` (the tCrm template's engine, docs/07-datatable.md): one
toolbar — search, **Filters**, **Sort**, **Columns** (show / hide / reorder), page size, export —
and the state in the URL (`search`, `sort`, `page`, `pageSize`, `f.<column>`). Column and page-size
choices are remembered per `tableId` in a **cookie** (not localStorage) so the server renders the
right columns on the first paint — no jump after hydration.

- Define columns in a serializable `…-columns.ts`; wrap `<DataTable>` in a `"use client"` file that adds
  the cell renderers (render functions can't cross from a server page). Give it a stable `tableId`.
- `mode="server"` (default): the page maps the URL to its query (`parseDataTableQuery`) and passes one
  page of rows + `total`. `mode="client"`: pass every row; the engine searches/filters/sorts in memory.
- `SimpleTable` (`components/simple-table.tsx`) is the static, server-rendered table for small
  read-only tables on dashboards — not for lists.
- Bookings has two views over the same data: **Bookings** (a row per purchase) and **Attendees**
  (a row per guest with a ticket; each registration question is a column, plus a split of how the
  guests answered each choice question — click a bar to filter). `lib`: `listAttendeesForOrg`.

## No layout shift

The shell must be complete on the first paint: `middleware.ts` forwards the path as
`x-tbook-pathname`, the admin layout resolves the event/group the URL is in
(`lib/workspace-nav.ts`) and seeds `WorkspaceSeed`, so the sidebar section and breadcrumbs don't wait
for hydration. Dates are formatted in `Europe/Budapest` (`lib/format.ts`) so server and browser agree.
`html { scrollbar-gutter: stable }` stops the page sliding when a scrollbar appears.
