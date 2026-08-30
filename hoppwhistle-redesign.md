# Hoppwhistle — Platform Redesign

Scope: `apps/web` only, the main platform. Admin, publisher, buyer and agent surfaces.

**In scope:** dashboard, calls, campaigns, publishers, buyers, numbers, reports, billing,
settings, call-center, and every page under `/buyer/*` and `/publisher/*`.

**Out of scope, do not touch:** `music-console`, `(research)/tools`, `payroll`, `retention`,
`dialer-v2-shadow`, `bot`.

**Borderline pages — resolved:** `flows` and `voice-agents` get the new shell, tokens and
typography, plus the chrome around the canvas (page header, panels, filter bars, empty
states) and DurationBar/StatusChip wherever they display call state or call length. Their
editor internals — node graph, drag handling, agent config forms — stay as they are.
`insurance-leads` gets a full rebuild; it is a list-and-detail surface, which is what the
new component layer is built for.

---

## What's actually wrong

Four things, all structural. Fix these and the app looks like a different product.

1. **There is no design system.** `src/app/globals.css` is 108 lines: the stock shadcn token
   block, duplicated across `:root` and `.dark` so the app is permanently dark, an emerald
   primary at `156 72% 40%`, and a 4px radius. No type scale, no spacing scale, no semantic
   colors for anything in your domain.
2. **There is no component layer.** `src/components/ui/` holds 23 unmodified shadcn
   primitives. Nothing above them. So `calls/page.tsx` is 1,797 lines, `dashboard/page.tsx`
   is 569, and each one hand-rolls its own cards, tables and states. Every screen drifts from
   every other screen because there's nothing holding them together.
3. **Every page is client-rendered.** All of them are `'use client'` with `useEffect` +
   `apiClient.get`. Navigate anywhere and you get an empty shell, a spinner, then a data
   dump. This is the single biggest reason the app feels slower and cheaper than it is.
4. **The navigation is a flat list.** Admin sees 14 sidebar items in one undifferentiated
   column, ordered by nothing. A new user cannot tell what the product is for by looking
   at it.

---

## Design direction

### Position

Ringba, Retreaver and TrackDrive are all dark dashboards. Hoppwhistle is currently a dark
dashboard with an emerald accent, which is the same look with a different hue. Going light
is the differentiating move, and for a screen where someone watches their own money it reads
as more trustworthy.

Light is the default and the only mode for the publisher and buyer surfaces. Dark exists for
one screen: the admin live board, which is a wall display in an ops room and has a real
reason to be dark.

### Palette

Paper and ink, with signal colours taken from call states rather than generic UI semantics.
Six values plus the neutrals.

```
--paper          #FBFAF8   page canvas
--surface        #FFFFFF   cards, panels
--sunken         #F3F1EC   table headers, code blocks, inset areas
--ink            #171614   primary text, big numbers
--ink-2          #55524B   secondary text
--ink-3          #8A867C   labels, metadata, placeholders
--rule           #E4E0D8   hairlines
--rule-strong    #CFC9BD   emphasized dividers
--live           #0F7A5A   connected, billable, earning
--ringing        #C8801A   in progress, pending, window open
--dropped        #A8452C   abandoned, missed, failed, disputed
--blocked        #6B4E9E   stopped on purpose — DNC, litigator, cap, balance
--money          #1B4D8F   currency and the one primary action per screen
```

The `blocked` violet matters. A call stopped by a compliance gate is not a failure, it is the
system working, and colouring it the same red as a dropped call trains people to ignore the
colour that should scare them.

Dark mode, admin live board only:

```
--paper #121110   --surface #1B1A18   --sunken #232120
--ink #F0EEE9     --ink-2 #A8A49B     --ink-3 #75716A
--rule #2E2C29    --live #3DBF93   --ringing #E8A742
--dropped #D9705A --blocked #A48BD6 --money #6FA3E0
```

### Type

Three faces, three jobs. All available on Google Fonts, all self-hosted through `next/font`.

- **Bricolage Grotesque**, variable, for page titles and hero numbers only. It has real
  character and it is not Inter. Used sparingly it makes the app recognizable in a screenshot.
- **Inter** for all body, labels, buttons, navigation.
- **IBM Plex Mono** with tabular figures for every number in the product. Phone numbers,
  durations, currency, timestamps, call IDs, source IDs. This is not decoration. Columns of
  money and duration have to align or they cannot be scanned, and the current app sets them
  in a proportional face.

Scale:

```
--t-hero     34px / 1.05  Bricolage 500   the one number per page
--t-title    20px / 1.2   Bricolage 500   page titles
--t-section  15px / 1.3   Inter 500       panel headers
--t-body     14px / 1.5   Inter 400
--t-label    12px / 1.3   Inter 500  +0.06em uppercase   column heads, tile labels
--t-meta     12px / 1.4   Inter 400       timestamps, helper text
--t-figure   19px / 1      Plex Mono 500  tile numbers
--t-data     13px / 1.4   Plex Mono 400   table cells
```

### Layout

Radius 6px on cards and panels, 4px on controls. Hairlines at 1px `--rule`, never a shadow to
separate two flat surfaces. Dense rows, 40px tall in tables, because these are power users
looking at hundreds of rows a day and whitespace they have to scroll past is not generosity.

### Signature 1 — the duration bar

Every call row renders its length as a thin horizontal bar with a tick mark where the billable
threshold sits. Under the threshold the bar is `--dropped`; over it, `--live`, with the portion
past the tick shown slightly darker so overage is visible.

This is the one element the whole product is built around. It turns "did this call pay" from a
number you have to read and compare into something you see. It appears in the buyer call list,
the publisher call list, the admin call log, and expanded on the recording player. Every role's
central question is answered by the same shape.

### Signature 2 — the live strip

A persistent horizontal strip below the topbar, on every page, scoped by role:

- Publisher: calls live right now, billable so far today, earnings today, ticking.
- Buyer: calls live now, spend today against cap, billable rate today.
- Admin: calls in flight, answer rate this hour, abandon rate this hour, revenue run rate.

Numbers update over the existing websocket. When a value changes, the digit itself briefly
takes `--live` and settles back over 600ms. Nothing else on the page moves.

Publishers keep Ringba open all day because their earnings number ticks up while they watch.
That is the mechanic worth copying, and it is honest because it is real money in real time.

### Restraint

That is the entire budget for boldness. Everything else stays quiet: flat surfaces, hairlines,
one accent per screen, no gradients, no glow, no animated charts, no confetti. Respect
`prefers-reduced-motion` on the live strip by swapping the colour flash for a static change
indicator.

---

## What gets built

### Component layer, `src/components/domain/`

Nothing here exists today. Everything below gets used on three or more screens.

```
StatTile          label, figure, sub, optional delta, optional sparkline lane
                  reserve the sparkline lane across a row so baselines align
Panel             Panel / PanelHeader / PanelBody, the only card wrapper
DataTable         sticky header, column sizing, row density, empty and loading
                  states built in, keyboard row navigation
DurationBar       signature 1
LiveStrip         signature 2
MoneyCell         Plex Mono, tabular, right-aligned, currency-aware
PhoneCell         formatted, click to copy, with state badge
StatusChip        one per enum in the schema — call state, dispute code, miss
                  reason, presence, settlement. Tones from the palette, and
                  blocked is violet not red
RecordingPlayer   waveform with the billable threshold marked
FilterBar         search, selects, date range, active-filter chips
SavedViews        named filter sets, per user
Pagination        shared, replacing the three hand-rolled versions
EmptyState        headline names the space, one line of body, one verb CTA
SheetDrawer       right-side detail drawer for a call, replacing full-page nav
```

### Rendering

Convert every rebuilt page to a server component that queries directly, with `Suspense`
boundaries and skeletons per panel. Keep `'use client'` only for genuinely interactive leaves:
filters, the softphone, the flow editor, the live strip. This alone will do more for perceived
quality than any colour.

Note: `apps/web` has no database access — no `prisma` dependency and no `@prisma/client`
import anywhere in `src`. It reaches data over HTTP through the `/api/v1/*` rewrite to
`apps/api`. "Query directly" therefore means a server-side `fetch` to the API from the server
component, not Prisma in the page. Same benefit, different implementation.

### Information architecture

Admin's 14 flat items become four groups:

```
LIVE       Live board · Call center · Calls
MARKET     Campaigns · Publishers · Buyers · Numbers
MONEY      Billing · Payouts · Reports
BUILD      Flows · Voice agents · Settings
```

Publisher and buyer navs are already short enough. They need better labels, not grouping:
"Wallet / Billing" becomes "Billing", "Targets" becomes "Targeting", "Costs" becomes "Spend".

### Pages, and the one job each

| Page | Its single job |
| --- | --- |
| `/publisher/dashboard` | Did today make money, and which source made it |
| `/publisher/calls` | Which of my calls paid, and why the others didn't |
| `/publisher/earnings` | What am I owed and when do I get it |
| `/publisher/payouts` | Payment history, no surprises |
| `/buyer/dashboard` | Am I getting what I'm paying for |
| `/buyer/calls` | Review, accept, dispute, in that order of speed |
| `/buyer/spend` | Where the money went, by campaign and by hour |
| `/buyer/targeting` | Change what I receive and see the price and volume move |
| `/buyer/billing` | Balance, burn rate, runway, top up |
| `/buyer/disputes` | File it in ten seconds, track the outcome |
| `/admin/live` | Is this hour healthy |
| `/calls` | Find any call and see everything about it |
| `/campaigns` | What is running and what is capped |
| `/publishers`, `/buyers` | Who is performing, who is a problem |
| `/numbers` | What inventory exists and what it's doing |
| `/billing`, `/reports` | Margin, by every dimension |

---

## Order and effort

Prompts 1 through 3 are the foundation and they must be sequential. Look at the output of
prompt 1 before approving anything after it, because every later prompt inherits those
decisions. Prompts 4, 5 and 6 are independent of each other and can run in parallel or in
whatever order matches where your revenue is.

If you only run two of these, run 1 and 5. The publisher surfaces are where retention lives,
because a publisher who can see why a call didn't pay stays, and one who can't leaves.
