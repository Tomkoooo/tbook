# tBook Design System — Master

> **Lookup rule:** when building a page, check `design-system/pages/<page>.md` first.
> If it exists, its rules override this file. Otherwise follow this file.

**Domain:** modern B2B operational SaaS dashboard (admin console for multi-tenant event booking)
**Stack:** Next.js 15 (App Router, RSC) · Tailwind CSS v4 (CSS-first `@theme`) · shadcn/ui (`new-york`, Radix, Lucide)
**Generated:** 2026-10-31 with the `ui-ux-pro-max` engine (v2.15), then mapped onto this codebase. See [Sources](#sources).

---

## 0. How this maps onto the code

The theme already has two layers in `apps/web/src/app/globals.css`, and this file keeps them:

1. **Brand tokens:** `--tbook-*` on `:root`, redefined for dark mode. **Change colours here only.**
2. **shadcn aliases:** `--background`, `--primary`, `--sidebar-*`, … point at the `--tbook-*` tokens, and `@theme inline` exposes them to Tailwind as `bg-background`, `text-primary`, etc.

So in components, use Tailwind semantic classes (`bg-card`, `text-muted-foreground`, `border-border`) and never raw hex.

### Where the engine was overridden

| Engine pick | Decision | Why |
|---|---|---|
| Style: **Glassmorphism** (from the generic "SaaS (General)" product row) | **Rejected** for the console. Use **Data-Dense Dashboard + Flat/Minimal** instead. | The engine's own product row lists *Dashboard Style: Data-Dense + Real-Time Monitoring*. Backdrop blur behind dense tables lowers contrast and costs paint time. The engine rates it ⚠ for both performance and accessibility. Blur is allowed only on the modal overlay. |
| Page pattern: **Hero + Features + CTA** | Applies to **storefront/marketing pages only**, never to `(admin)`. | This is a landing-page pattern. The console uses the app-shell layout in §3. |
| Fonts via `@import url(fonts.googleapis.com)` | Load with **`next/font`** instead. | The engine's own Next.js guideline (severity Medium) says to self-host and avoid layout shift. |
| Button hover `translateY(-1px)`, card hover lift + `cursor:pointer` on every card | Dropped for static cards and dense UI. | It conflicts with the engine's own "no layout-shifting hovers" rule. Lift and pointer go only on cards that are clickable. |

---

## 1. Colour

### 1.1 Engine palette: "B2B Service — professional navy + blue CTA"

Picked by the `--design-system` run, and also the top hit of the color-domain search for "B2B SaaS dashboard professional".

| Role | Hex | Tailwind equivalent | Maps to token |
|---|---|---|---|
| Primary (ink/navy) | `#0F172A` | slate-900 | headings, sidebar active text, `--tbook-text` (strong) |
| Secondary | `#334155` | slate-700 | `--tbook-text-muted` (body-secondary) |
| CTA / Accent | `#0369A1` | sky-700 | `--tbook-accent` → `--primary`, `--ring`, `--sidebar-primary` |
| Background | `#F8FAFC` | slate-50 | `--tbook-bg` → `--background` |
| Text | `#020617` | slate-950 | `--tbook-text` → `--foreground` |

Contrast: `#0369A1` on white is about 5.9:1 and white on `#0369A1` is the same, so it passes AA for text and buttons. `#334155` on `#F8FAFC` is about 9.9:1.

### 1.2 Full light token set (proposed values for `:root`)

Neutrals are the slate ramp, chosen to match the engine palette. Status colours keep the engine's real-time-monitoring semantics (critical red, warning orange/amber, normal green, info blue), shifted to AA-safe text tones.

```css
:root {
  --tbook-bg:            #F8FAFC; /* slate-50  — engine Background */
  --tbook-surface:       #FFFFFF;
  --tbook-surface-alt:   #F1F5F9; /* slate-100 — muted, table header, zebra */
  --tbook-border:        #E2E8F0; /* slate-200 — engine input border */
  --tbook-border-strong: #CBD5E1; /* slate-300 */
  --tbook-text:          #020617; /* slate-950 — engine Text */
  --tbook-text-muted:    #475569; /* slate-600 — one step lighter than the engine Secondary (#334155) so muted text reads as secondary next to body text */
  --tbook-text-faint:    #64748B; /* slate-500 — meta only, ≥4.5:1 on white */
  --tbook-accent:        #0369A1; /* sky-700   — engine CTA */
  --tbook-accent-hover:  #075985; /* sky-800 */
  --tbook-accent-text:   #FFFFFF;

  --tbook-info-bg:    #E0F2FE; --tbook-info-text:    #075985;
  --tbook-success-bg: #DCFCE7; --tbook-success-text: #166534; /* normal  #22C55E family */
  --tbook-warning-bg: #FEF3C7; --tbook-warning-text: #92400E; /* warning #FFA500 family */
  --tbook-danger-bg:  #FEE2E2; --tbook-danger-text:  #991B1B; /* critical #DC2626 family */
  --tbook-neutral-bg: #F1F5F9; --tbook-neutral-text: #475569;
}
```

`--destructive` maps to `--tbook-danger` (`#DC2626`, the engine's `--critical-color`).

### 1.3 Dark mode

Engine anti-pattern: **"Dark mode by default."** The current behaviour already fits this rule: dark mode follows `prefers-color-scheme`, and `[data-theme]` lets the user override it. Keep it. The values below are derived from the same slate/sky ramps and are not engine output:

```css
--tbook-bg: #020617;  --tbook-surface: #0F172A;  --tbook-surface-alt: #1E293B;
--tbook-border: #1E293B;  --tbook-border-strong: #334155;
--tbook-text: #F1F5F9;  --tbook-text-muted: #CBD5E1;  --tbook-text-faint: #94A3B8;
--tbook-accent: #38BDF8;  --tbook-accent-hover: #7DD3FC;  --tbook-accent-text: #020617;
```

### 1.4 Data / chart colours

Data-Dense style: neutral chrome, with colour reserved for data (blue, green, red). For series, use blue `#0369A1`, teal `#0D9488`, amber `#D97706`, violet `#7C3AED`, slate `#64748B`. **Do not** reuse the status red or green as series colours, because they mean alerts. For anything with charts, run the `dataviz` skill.

---

## 2. Typography

### 2.1 Engine picks

| Source | Heading | Body | Notes |
|---|---|---|---|
| `--design-system` (primary) | **Plus Jakarta Sans** | **Plus Jakarta Sans** | "friendly, modern, SaaS, clean, professional". Best for SaaS, dashboards, B2B, productivity. Weights 300–700. |
| typography search "dashboard data dense" | Fira Code | Fira Sans | "Dashboard Data" pairing: mono for data, sans for labels |

**Decision (updated 2026-10-31, owner's choice):** **Geist** as the single UI family and **Geist Mono** as `font-mono` for codes and IDs (order numbers, voucher codes, ticket refs). This replaces the engine's Plus Jakarta Sans pick. Numbers in tables and KPIs use the sans with `tabular-nums`.

### 2.2 Loading (Next.js)

`next/font` self-hosts the fonts, with no layout shift. They are set once on `<body>` in `apps/web/src/app/layout.tsx`:

```tsx
import { Geist, Geist_Mono } from "next/font/google";
const sans = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-geist-mono", display: "swap" });
```

`latin-ext` covers the Hungarian ő and ű. `globals.css` maps the two variables onto Tailwind's `font-sans` and `font-mono`.

### 2.3 Scale (data-dense: 12–14px working sizes)

| Use | Size / line-height | Weight | Tailwind |
|---|---|---|---|
| Page title | 22px / 28px | 600 | `text-[22px] leading-7 font-semibold` |
| Section / card title | 16px / 24px | 600 | `text-base font-semibold` |
| Body, forms | 14px / 20px | 400 | `text-sm` |
| Table cell | 13–14px / 20px | 400 (numbers `tabular-nums`) | `text-[13px]` or `text-sm` |
| Meta, helper, table header | 12px / 16px | 500 | `text-xs font-medium text-muted-foreground` |
| KPI value | 24–28px / 32px | 600, `tabular-nums` | `text-2xl font-semibold tabular-nums` |

Inputs must be at least **16px on mobile** (the engine's input spec) so that iOS does not zoom on focus. Use `text-base md:text-sm`, which shadcn `Input` already does.

---

## 3. Layout patterns

### 3.1 App shell (engine "Data-Dense Dashboard" variables)

| Token | Engine value | Notes |
|---|---|---|
| `--sidebar-width` | 240px | shadcn Sidebar default is 16rem (256px). Either is fine; set `--sidebar-width: 15rem` on `SidebarProvider` to match. |
| `--header-height` | 56px | `AdminHeader`: `h-14`, sticky, `border-b` |
| `--grid-gap` | 8px | Use **8px inside widgets** and **16px (`gap-4`) between cards**. The existing `--tbook-gap` of 16px stays as the page rhythm. |
| `--card-padding` | 12px | `p-3` for KPI and compact cards. Form and detail cards use `p-4`/`p-6` (shadcn Card default). |
| `--table-row-height` | 36px | `h-9` rows. Use 44px (`h-11`) on touch layouts. |
| Grid | 12 columns | `grid grid-cols-12 gap-4`. KPI cards `col-span-12 sm:col-span-6 xl:col-span-3`. |

The structure already exists in `app/(admin)/admin/layout.tsx`:

```
SidebarProvider                        ← at layout level (shadcn rule, severity High) ✔ already done
├── AppSidebar (collapsible="icon")    ← org switcher · nav groups · user menu
└── SidebarInset
    ├── AdminHeader  h-14 sticky       ← SidebarTrigger · Breadcrumb · ⌘K Command · actions
    └── main  p-4 md:p-6  max-w-[1440px]
        ├── PageTitle + primary action (right-aligned)
        ├── KPI row (4 cards)
        ├── Filter bar (sticky under header for long lists)
        └── Table / detail content
```

### 3.2 Page archetypes

| Archetype | Pattern (engine source) | Must-haves |
|---|---|---|
| **Overview** | Data-Dense: KPI row above charts and tables | KPI cards show value, delta and period. Skeletons while loading. |
| **List / index** (events, bookings, orders) | Data-Dense: sortable table, filters, sticky header | shadcn `Table` (not a div grid), sortable headers, sticky `thead`, `overflow-x-auto` wrapper, empty state, pagination, export |
| **Detail** (event → day → booking) | Drill-Down: summary to detail, context kept | Sticky breadcrumbs, a visible back path, deep-linkable URLs (state in search params), and indented levels (`--level-indent: 24px`) |
| **Live ops** (POS, check-in, capacity) | Real-Time Monitoring | Status dot with a 2s pulse (`--live-indicator: #22C55E`), connection/refresh indicator, critical alerts first, toast duration 5s, offline fallback |
| **Storefront / marketing** | Hero + Features + CTA | CTA above the fold. These are the only pages where the engine's landing pattern applies. |

### 3.3 Breakpoints

Verify layouts at **375 / 768 / 1024 / 1440px**. Below `md`, the sidebar becomes a Sheet (shadcn does this automatically), and tables either scroll horizontally or collapse to card rows. Pages must never scroll horizontally.

---

## 4. Components (shadcn mapping)

| Need | Use | Engine rule |
|---|---|---|
| Navigation | `Sidebar*` | Use Sidebar instead of a custom `div.fixed` |
| Tabular data | `Table*` | Use Table instead of a grid of divs |
| Scaffolding new screens | `npx shadcn@latest add dashboard-01` (adapt it) | Start from blocks |
| Feedback | Inline `<Notice>` (shadcn Alert) inside the form that triggered it. Add `sonner` `<Toaster />` to the layout only once there is non-form feedback to show. | Engine rule: Toaster in layout, never per page |
| Async content | `Skeleton` with fixed height | Avoid layout shift (severity High) |
| Command palette | `Command` (cmdk), opened with ⌘K | — |
| Status | `Badge` variants: success, warning, danger, info, neutral → `--tbook-*-bg/text` | — |

**Component specs (adjusted from the engine):**

- **Buttons:** shadcn sizes (`h-9` default, `h-8` sm in toolbars and tables). Radius `--radius` (8px). Weight 500–600. Transition colours over 150–200ms. Primary uses `bg-primary`. Secondary is `variant="outline"`, with a 1px border, not the engine's 2px.
- **Cards:** `bg-card border rounded-lg` with a soft shadow (`--tbook-shadow`). Radius is 12px (`rounded-xl`) for dashboard cards. Hover lift only if the whole card is a link.
- **Inputs:** 1px `border-input`. On focus, `ring-[3px] ring-ring/20` with the border set to `ring`. Mobile font size at least 16px.
- **Modals:** overlay `bg-black/50 backdrop-blur-[4px]`. This is the only blur in the console. Radius 16px, max width about 500px for forms.
- **Shadows:** sm `0 1px 2px rgb(0 0 0/.05)`, md `0 4px 6px rgb(0 0 0/.1)` for popovers and dropdowns, lg `0 10px 15px rgb(0 0 0/.1)` for dialogs. Static cards use sm or a border only.

**Spacing scale** (engine): 4 · 8 · 16 · 24 · 32 · 48 · 64px. In Tailwind: `1 · 2 · 4 · 6 · 8 · 12 · 16`. Use only these steps.

---

### App building blocks (`apps/web/src/components/`)

Build pages from these plus `components/ui/*`. Don't use raw HTML controls or one-off CSS classes.

| Component | Use |
|---|---|
| `PageTitle` | Page heading, description, actions, optional `back` link |
| `SectionCard` | Titled panel; `flush` for edge-to-edge tables |
| `Stat`, `StatGrid` | KPI cards |
| `EmptyState` | Empty tables/panels |
| `LinkPagination` | URL-driven paging |
| `DescriptionList` | Label/value detail rows |
| `Notice` | Status message (info/success/warning/danger) |
| `FormField`, `NativeSelect`, `CheckboxField` | Form rows that submit through FormData |
| `lib/status-tones.ts` | The only place a status picks its badge colour |

## 5. Anti-patterns (do not)

- Glassmorphism or backdrop blur on surfaces holding data
- Excessive animation. Motion is limited to 150–300ms state transitions, plus the live pulse
- Dark mode forced by default
- Emojis as icons. Use **Lucide** only (already configured)
- Clickable elements without `cursor-pointer`
- Hover effects that shift layout (scale or translate inside dense lists)
- Text below 4.5:1 contrast. Watch `--tbook-text-faint`
- Instant state changes with no transition
- Focus states that are hidden. Keep the shadcn `focus-visible:ring`
- Fonts loaded through a `<link>` or `@import` to Google
- Status colours reused as chart series colours

## 6. Pre-delivery checklist

- [ ] Only semantic classes and tokens, no raw hex in components
- [ ] Lucide icons only, no emoji
- [ ] `cursor-pointer` and hover transitions (150–300ms) on every clickable element
- [ ] Contrast of at least 4.5:1 in both light and dark
- [ ] Visible keyboard focus. `prefers-reduced-motion` turns off the pulse and transitions
- [ ] Skeletons for every async region. No content popping in
- [ ] Tables: sortable, sticky header, empty state, horizontal scroll on mobile
- [ ] Checked at 375 / 768 / 1024 / 1440px. No horizontal page scroll
- [ ] Numbers use `tabular-nums`. Codes and IDs use `font-mono`

---

## Sources

Commands run with the `ui-ux-pro-max` skill (copy at `../tdarts_release/.cursor/skills/ui-ux-pro-max`):

```bash
S=../tdarts_release/.cursor/skills/ui-ux-pro-max/scripts
python3 $S/search.py "modern B2B operational SaaS dashboard" --design-system -p tbook
python3 $S/search.py "data-dense dashboard enterprise minimal"   -d style      -n 3
python3 $S/search.py "B2B SaaS operations admin dashboard"       -d product    -n 3
python3 $S/search.py "dashboard data dense tabular numbers"      -d typography -n 3
python3 $S/search.py "B2B SaaS dashboard professional"           -d color      -n 3
python3 $S/search.py "dashboard layout sidebar data table"       --stack shadcn -n 5
python3 $S/search.py "dashboard layout font performance"         --stack nextjs -n 4
```

Page overrides go in `design-system/pages/<page>.md`, generated with `--persist --page <name>` or written by hand.
