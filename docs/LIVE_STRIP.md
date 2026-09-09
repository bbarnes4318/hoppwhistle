# The live strip — Phase 6

The row above every page in the agency portal. It is the most valuable space in
the application: it is on screen whatever anybody is doing, and it is the only
thing in the product that a person reads without having navigated to it.

Read `docs/RATING.md` and `docs/BILLING.md` first. Every figure here is a
projection of a view those two already define, and nothing in this phase
measures a call, prices an application or sums a charge.

**There are no refunds, credits, reversals or make-goods**, here or anywhere,
including in the copy. Nothing on this strip is ever labelled "booked".

---

## 1. What it replaced

Four large cards across the full width of every page:

| | |
| --- | --- |
| Calls in flight | em dash |
| Answer rate, last 60 minutes | em dash |
| Abandon rate, last 60 minutes | em dash |
| Revenue run rate per hour | $0.00 |

Those are pay-per-call marketplace metrics from this application's previous life
as a publisher/buyer platform, and they predate the entire agency portal. Three
had no source for an agency at all. The fourth had a source and was still wrong:
agency revenue is a nightly ACH debit, not an hourly run rate, so it read $0.00
in a colour meaning money.

The mechanism was not the problem — the honest em dashes were correct, and the
hook that produced them is the one still in use. The figures were the problem.

---

## 2. The three questions

An agency principal glancing at any screen asks these, in this order.

**Am I on pace today?** Applications submitted, against the daily block they
paid for, and calls delivered so far. Not a percentage of a target nobody set:
the actual count against the number they bought.

**What is today costing me?** What is left on the block, Overrun so far and the
dollars it adds to tonight's debit, and the projected total debit at settlement.
This is the number they open the portal for.

**Where is my rate going?** The rate per application in force today, and the
rate the trailing window is tracking toward for tomorrow.

### The two rates are never conflated

`Rate now` is what the agency is charged per submitted application today. It was
set by the trailing three-Delivery-Day window, at the last rating run.

`Rate tomorrow` is what the curve returns for the window ending *today*, if
today closed now. Provisional, and driven by a different closing percentage.

They are separate figures, adjacent, and each is labelled with what it does —
"per application" and "if today closed now". An agency that reads the second as
the first believes it is being charged something it is not, which is shaped like
a billing dispute. See `docs/RATING.md` §4, which draws the same line on
`/rating` and for the same reason.

**Today's closing percentage is deliberately not on the strip.** It prices
nothing, and a percentage sitting between two rates is the figure most likely to
be read as the one that set them. It is on `/delivery` and on `/rating`, in both
cases labelled "does not set today's rate", where there is room to say so.

### The figures

Seven for an enrolled agency, in question order:

| Figure | | |
| --- | --- | --- |
| Applications | submitted today | `of N block` |
| Calls delivered | answered by an agent | `N in progress` |
| Block left | paid for and unused | |
| Overrun | applications beyond the block | `$N tonight` |
| Tonight | the projected debit at settlement | provisional |
| Rate now | dollars per application, today | |
| Rate tomorrow | what the window ending today returns | provisional |

Two for an agency that is not enrolled in billing. Three for an agent. Five for
NetEnroll staff. See §4.

---

## 3. Every figure comes from the server

Nothing on the strip is computed, derived or estimated in the browser — not a
rate, not a projection, not a total, and not the difference between an agent's
closing percentage and their agency's, which the server also returns.

More than that: nothing on the strip is a *second definition* of anything. Each
reading is a projection of a view that already exists and that a page already
renders.

| reading | from | the page that renders the same view |
| --- | --- | --- |
| agency | `getDeliveryToday()` | `/delivery` |
| agent | `getAgentSelfView()` | `/delivery/me` |
| platform | `getPlatformOverview()`, plus `getDeliveryToday()` per enrolled agency for tonight's projection | `/delivery`, cross-agency |

Same function, same tenant, same day. The two screens cannot disagree, because
there is only one arithmetic and neither of them owns it. Two screens
disagreeing about what tonight costs is worse than one screen being wrong.

The client formats with the same helpers `/delivery` formats with
(`count`, `dollars`, `pct`, `points` in `components/delivery/ledger`), so where
both carry a figure they carry the same string, character for character. The
browser smoke test compares those strings on every load.

### An absent figure is an em dash and a reason

A figure the server cannot source correctly comes back `null`, with a sentence
explaining why in the response's `unavailable` map. The strip renders it muted,
as an em dash, with that sentence as the tooltip.

Nothing is estimated, nothing is derived from an unrelated number, and nothing
is carried forward from an earlier poll. A fabricated live number on a screen
where somebody watches their own money is worse than an absent one, and an em
dash with no explanation reads as a bug rather than as a known gap. This is the
behaviour the previous strip already had; it is kept.

The one figure that is not an em dash when it is absent is `Rate tomorrow` for a
window below the curve minimum. Below 5% there is no rate — see
`docs/RATING.md` §2 — and that is a different fact from "we could not work it
out", so it reads **review** rather than an em dash, and never `$0.00`.

### An unenrolled agency sees no billing figures at all

Billing is opt-in per agency and off by default (`docs/BILLING.md` §0). An
agency a platform admin has not enrolled is not gated, not metered and not
settled.

It is shown the operational counts and nothing else — not zeroes, and **not em
dashes either**, because an em dash under a label reading "Tonight" is still a
screen telling somebody they owe an unknown amount.

That is structural rather than a rendering decision: the API omits the whole
`billing` object from the response for an unenrolled agency, so there is no
field for a renderer to reach for. `apps/web/e2e/platform-landing.smoke.mjs`
asserts both halves — that no figure on the strip carries a `$` or a
billing word, and that the agency under test really is unenrolled, so the
assertion cannot pass vacuously.

---

## 4. Three readings, and the session decides which

Scope is decided on the server, from `request.user`, and nowhere else. No path
segment, no query parameter, no header — the rule Phase 1 established in
`lib/tenant-context.ts` and that this does not put an exception inside. The
client does not ask for a reading; it is given one and renders it.

### Agency — an administrator or owner inside an agency

The seven figures above, from the acting tenant and no other. A platform
operator who has entered an agency gets this reading, because inside an agency
they carry that agency's administrator roles.

### Agent — the AGENT role inside an agency

Their calls taken today, their applications submitted, and their own closing
percentage against their agency's, with the difference in points.

**No money, no rate, and no other agent.** That is a property of the query
rather than of the rendering: `getAgentSelfView()` loads no rate, no balance, no
overrun and no charge, so there is nothing in the payload to render by accident.
The same promise `/delivery/me` already makes.

### Platform — NetEnroll staff who have entered no agency

Agencies delivering right now, calls delivered across every production agency
today, applications across them, tonight's projected settlement summed across
the enrolled ones, and how many agencies need somebody.

"Needs attention" is `PlatformTotals.flagged` — the same count the cross-agency
`/delivery` shows in its own header, from the same function. Two different
answers to "how many need me" is how one of them gets ignored. It covers the
four conditions the brief names — below the curve minimum and paused, at the
Overrun ceiling, a failed or unpaid settlement, no valid mandate — and the three
the platform page also counts: a suspension, an enrolled agency that has never
settled, and an open chargeback.

"Delivering" is agencies with a call connected to an agent at this instant,
using `CALL_IN_PROGRESS` — the agency panel's own predicate with the tenant left
off, asked of every production tenant in one grouped query. One definition, two
scopes.

Non-production tenants are excluded from every figure, exactly as they are from
the totals on the page below. A total that includes a demo fixture is a total
nobody can act on.

### Publisher and buyer — unchanged

Both roles still exist in this application and their strip is untouched: calls
in flight, billable calls, earnings, spend against a call cap, from
`GET /api/v1/live/metrics` exactly as before.

---

## 5. The endpoint, and why it is a second one

`GET /api/v1/live/strip` is new. `GET /api/v1/live/metrics` is unchanged.

The brief allowed either adding the agency and platform shapes to the existing
endpoint or introducing a separate one. **A separate endpoint**, for a reason
that is not tidiness:

> **The platform reading has no acting tenant.** `/live/metrics` resolves a
> tenant first and refuses without one, which is right for every role it serves.
> NetEnroll staff who have entered no agency are precisely the caller it must
> refuse — and precisely the caller the new endpoint exists to answer. Putting
> the platform shape there would mean a "unless the caller is staff" branch
> inside a tenant gate, and that gate is the one place in this codebase that has
> to stay a single unconditional rule. Phase 1 exists because it once was not.

Two consequences follow, both good. The two endpoints cache on different clocks:
the marketplace figures move by the second and are cached for three, these move
by the delivered call and the submitted application and are cached for ten
(thirty for the platform reading). And the strip's own poll never asks an
agency-scoped question when there is no agency to ask it of — the loop that has
already been fixed once is not reintroduced by adding a shape.

`/api/v1/live/strip` answers a **bare** body, not a `{ data: ... }` envelope,
matching its sibling under `/api/v1/live/`. See `ApiResponse` in
`apps/web/src/lib/api.ts` for why that distinction is worth naming.

### Refusals

The route sends exactly one: `describeTenantRefusal()`, for a caller who is not
authenticated, or who has no acting tenant and is not staff. A signed-in tenant
member who is neither an administrator nor an agent gets
`{ scope: 'none', reason }` and a strip that renders nothing — a 403 on every
page load is noise in the log, a red line in every console, and for a client
that reads refusals as dead sessions, a bounce to `/login`.

---

## 6. Cost

The strip renders on every page for every user. At launch that is 45 licensed
agents and a few principals on one agency, 15 more on the other, plus wall
displays.

**The poll is thirty seconds, not five.** These figures move by the delivered
call and by the submitted application; a five-second poll asked the database six
times for every change it could possibly show. It runs on `createLivePoller`, so
a tab nobody is looking at costs nothing and refreshes the moment it comes back,
and each tick is jittered by ±15% so tabs opened together at the start of a
shift do not stay in lockstep.

**The API caches on top of that.**

| reading | key | TTL | why |
| --- | --- | --- | --- |
| agency | per tenant | 10s | every principal on a floor shares one entry |
| agent | per tenant and user | 10s | it IS per user; four indexed counts |
| platform | one, platform-wide | 30s | the expensive one, and the fewest readers |

Redis being down never fails the request: a miss costs a query, not a page.

The platform reading is the expensive one — a full cross-agency overview plus
one `getDeliveryToday()` per *enrolled* agency (two at launch, not one per
tenant) and one grouped in-flight query. It is read by NetEnroll staff, it is
cached once for everyone, and it is the only reading that pays that cost.

---

## 7. Space, and not repeating the page below

It was four large cards across the full width. It is one dense row: a small
uppercase label, the figure in the tabular mono face at the reading size, and
its denominator or caveat **inline** beside it rather than on a third line.
Legible from across a desk; it does not dominate the page beneath it. The
browser smoke test fails the row if it grows past 64px on any page.

### The rule

> **A figure the page underneath renders as its hero — the single largest
> element on the screen — is not repeated in the strip on that page.**

Anything smaller than a hero still appears in both. The strip is read at a
glance from across the room and the page is read up close; a figure in a
supporting row is not competing with anything.

These are all the places it applies, because these are the only pages in the
product with a hero figure the strip also carries:

| | drops | keeps |
| --- | --- | --- |
| agency on `/delivery` | the projected charge at tonight's settlement, and the current rate | applications, calls, block, overrun, tomorrow's rate |
| agent on `/delivery/me` | the agent's own closing percentage | their calls, their applications |

**Keyed by reading and path, not by path alone**, and that distinction is load
bearing. `/delivery` is two pages: an agency's own panel, and the cross-agency
view whose hero is "Settled today" — a settled figure the strip never carries.
The platform reading has a figure of its own called `tonight`, a projection
across every agency rather than that hero, and a rule keyed on the figure id
alone silently deleted the one figure staff came to the page for. A test caught
exactly that, which is the reason there is a test for a layout rule.

### The one page with no strip

`/call-center` returns from the dashboard layout before the chrome is built: no
sidebar, no topbar, a locked viewport and an integrated dialer. It has never
carried the strip, in this shape or the marketplace one it replaced, and putting
a row above a deliberately chrome-free screen an agent works a shift inside is a
change to that page rather than to the strip. The smoke test asserts the strip
is **absent** there, so this stays a decision somebody made rather than a hole
in the sweep.

---

## 8. Verification

Three consecutive phases shipped a defect one load of the page would have
caught. This one renders on every page in the application.

### The browser sweep

`apps/web/e2e/platform-landing.smoke.mjs` boots the real API against a
disposable database, boots the real web app, and loads every significant route
under every role set in Chromium. Six assertions per load, three of them new:

1. the page rendered, the URL did not move, no prompt appeared;
2. nothing was refused — no 4xx or 5xx from any request the load made;
3. the page is legible on the light ground;
4. **the strip rendered**, with figures on it, in one row no taller than 64px,
   and every figure's machine-readable value is the string actually on screen;
5. **it is the right reading** — `agency`, `agent`, `platform`, `publisher` or
   `buyer` for the session signed in, asserted rather than inferred from labels,
   because an agent must never be handed the agency's money and staff with no
   agency entered must never be handed one agency's;
6. **it agrees with the page below** — every figure the strip and the page both
   carry reads the same string for the same tenant, on `/delivery` and
   `/delivery/me`, under all three readings of `/delivery`;
7. **an unenrolled agency is shown no money** — no `$`, no billing word — with
   the premise itself checked, so the assertion cannot pass vacuously.

The idle check also tightened: a settled `/delivery` now has exactly two
pollers, its own cross-agency view and the strip, both at thirty seconds.

```
SMOKE_DATABASE_URL=postgresql://user:pass@localhost:5432/hopwhistle_test \
SMOKE_REDIS_URL=redis://localhost:6379/3 \
node apps/web/e2e/platform-landing.smoke.mjs
```

### The fast half

`apps/web/src/components/layout/__tests__/live-strip-figures.test.ts` runs
without a database, a browser or a network, and pins the rules about SHAPE that
a browser check would find only if the fixture happened to exercise them:

- the agency reading answers the three questions in order;
- applications are counted against the block they paid for, not a percentage of
  a target nobody set;
- the rate in force and the rate tomorrow is tracking toward are two figures
  with two labels, and today's closing percentage is not between them;
- a below-minimum window reads **review**, never `$0.00`;
- an unenrolled agency gets the operational counts and no money, in any form;
- the agent reading carries no `$` and names no other agent;
- the hero-suppression rule drops what it should on each page and nothing
  anywhere else.

---

## 9. Migration

**None.** This phase adds no table, no column, no index and no enum member. It
reads what Phases 2 and 3 already record and nothing else, so there is nothing
to pipe into psql and nothing in the deploy path to change.
