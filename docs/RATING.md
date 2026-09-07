# Measurement and the rate engine — Phase 2

NetEnroll sells inbound final-expense calls to licensed agencies and is paid per
submitted application. What an agency pays per application depends on how well
it closes the calls it is given. This document is the definition of that
arithmetic and the record of the decisions inside it.

**Phase 2 does not charge anyone and does not gate delivery.** Both are Phase 3,
which is now built: see `docs/BILLING.md` for the credit ledger, Overrun,
delivery gating and the daily settlement that bills from these numbers. This
document remains the definition of the arithmetic.

**There are no refunds, credits, reversals or make-goods**, anywhere: not in the
schema, the API, the UI or the copy. A carrier's decision after an application is
submitted — issued, declined, rescinded, lapsed — never returns money and is not
an input to any calculation here. Grep the schema: there is no column for it.

---

## 1. Measurement

    closing percentage = submitted applications / delivered calls

Defined once, in `apps/api/src/services/rating/measurement.ts`, and nothing else
redefines either side.

### Delivered call

A call routed to that agency and **answered by one of its agents**. In the
schema: a `Call` row whose `tenantId` is the agency and whose `answeredAt` is
set.

Calls that ring out, abandon, or arrive when the agency is not staffed all leave
`answeredAt` null and are excluded by that fact alone. There is deliberately no
list of excluded dispositions — a list is a thing that drifts out of date, and
the property that matters ("did an agent pick up?") is already one column.

Two further narrowings, both stated in the code:

- **`direction: INBOUND`.** A delivered call is one NetEnroll delivered. An
  agency's own outbound dialling is its business. Counting it would inflate the
  denominator, depress the measured closing percentage and *raise* the agency's
  price — an error that costs the customer money is not an acceptable default.
- **`blocked: false`.** A call the compliance layer refused was never offered to
  an agent. It cannot carry `answeredAt` today; the flag is asserted anyway so a
  future path that records a blocked-but-connected call cannot quietly enter the
  denominator.

**No minimum duration.** A call answered and immediately dropped is a delivered
call: the agency was given the opportunity. A duration threshold is a lever on
the price that nobody agreed to.

Delivery is attributed by `answeredAt`, not `createdAt`. A call that starts
ringing at 23:59:58 and is answered at 00:00:02 was delivered on the second day.

### Submitted application

An `InsuranceCarrierApplication` for that agency that reached submitted state.

`submittedAt` is a new column, written **once**, on the first transition into
`SUBMITTED` (`services/carrier-rpa/application-store.ts`). A retried automation
run or a redelivered completion carries the existing timestamp forward rather
than replacing it, which matters because moving it could move the application
across a business-day boundary and change two different days' rates.

It is written in the **same statement** as the status. This was briefly a second
statement — an `updateMany` guarded on `submittedAt: null` — which reads well
and is wrong here: the only caller wraps the whole function in a try/catch that
logs and continues, so a failure on the second statement would leave the row
`SUBMITTED` with a null `submittedAt`. That is an application the agency
submitted, that the closing percentage never counts, with nothing on the surface
to say so — a silently uncounted application is a silently wrong price. So
`SUBMITTED` and `submittedAt` succeed or fail together.

Attribution is by submission timestamp, not by the date of the call that
produced it. An application from a 4pm call submitted at 9am the next day belongs
to the next day.

### Three kinds of day, and one file each

Phase 2 used one term, "business day", for two incompatible jobs. This is the
correction, and it matters because the wrong reading is invisible: a shortened
deadline is not an error message, it is just an earlier date.

| Term | Means | Used for | File |
| --- | --- | --- | --- |
| **Calendar day** | 00:00:00.000–23:59:59.999 in America/New_York | the day boundary everything else is built from; the day a rate is effective on; the day an application is attributed to | `services/rating/calendar-day.ts` |
| **Business Day** | Monday–Friday, excluding US federal holidays (observed) | **contractual notice periods only** | `services/rating/business-day.ts` |
| **Delivery Day** | a calendar day on which NetEnroll delivered at least one call **to that agency** | **the rating window only** | `services/rating/delivery-day.ts` |

**None of the three may stand in for another.**

#### Calendar day

The timezone. Not `toISOString().slice(0,10)` — that is UTC, and for five hours
every evening it names tomorrow, which would move every application submitted
after 8pm Eastern onto the following day. Not the server's zone (UTC in
production, whatever the laptop says otherwise). Not the browser's.

DST is handled and pinned: the spring-forward day is 23 hours long, the
fall-back day is 25, and a winter day starts at 05:00Z where a summer day starts
at 04:00Z.

#### Business Day — contractual periods only

The signed agreement counts four things in Business Days, and every one of them
is a period the agency is entitled to:

| Period | Length |
| --- | ---: |
| Settlement dispute window | 5 Business Days |
| Delivery window | 30 Business Days |
| Grace period on failed settlement | 5 Business Days |

Reading these as calendar days **shortens every one**. A five-day dispute window
opened on a Thursday runs Thu, Fri, Mon, Tue, Wed and expires on the following
**Wednesday**; read as calendar days it expires on **Monday**, and the agency
loses two days of a right it was granted in writing.

The eleven US federal holidays are computed, not tabulated, so the definition
does not quietly expire at the end of a hardcoded list of years. The **observed**
day is the one that counts (5 U.S.C. 6103(b)): a fixed-date holiday falling on a
Saturday is observed the preceding Friday, on a Sunday the following Monday. So
Independence Day 2026 falls on a Saturday and Friday 3 July is not a Business
Day.

Two functions, deliberately named apart, because both readings appear in
commercial writing and a single ambiguous helper is how the off-by-one gets in:

- `businessDayPeriodEnd(start, n)` — an *n*-Business-Day period **beginning** on
  `start`, counting `start` as day 1. Thursday + 5 → the following Wednesday.
- `addBusinessDays(day, n)` — *n* Business Days **after** `day`, exclusive of it.
  Thursday + 5 → the following Thursday.

Phase 2 does not enforce any of these periods. Phase 3 enforces the grace
period on failed settlement, using `businessDayPeriodEnd()` from here rather
than reinventing it: a Friday failure with Labor Day inside the period expires
on the following Friday, not on the Tuesday calendar days would give.

#### Delivery Day — the rating window only

A calendar day on which NetEnroll delivered at least one call to **that agency**,
using the same `deliveredCallWhere` predicate the denominator is counted with —
one definition, used twice, rather than two that can drift.

The rating window is **the trailing three Delivery Days**. This is right whether
an agency works five days a week or seven, and — the point — it does not depend
on knowing which:

| | Monday's window |
| --- | --- |
| agency that takes no weekend calls | the prior **Thursday, Friday, Monday** |
| agency that does take weekend calls | **Saturday, Sunday, Monday** |

Calendar days would price the first agency's Monday off Saturday and Sunday, two
days on which it was delivered nothing, with a third of its denominator zero for
reasons unconnected to how it closes. Excluding weekends would be wrong the
other way for the second. Neither requires asking.

The definition deliberately does **not** read a configured schedule. A schedule
field is something somebody has to keep true, and a stale one would misprice
silently; "a day we delivered a call" is observable from the same rows the
closing percentage is already measured from.

**The window is not contiguous.** Thursday/Friday/Monday spans a weekend, so
`windowStart`..`windowEndExclusive` covers five days while the counts cover
three. Anything recomputing from a `rate_changes` row must use `windowDayKeys`;
both are stored so that is unambiguous rather than inferred, and
`measureDeliveryDayWindow` sums per day for exactly this reason.

**A short window is recorded short, never padded.** A new agency with two
Delivery Days is priced on two days of evidence and `windowDaysFound` says 2
against `windowDeliveryDays` 3. `deliveryDayLookback` (60 calendar days,
configurable) bounds the search; an agency with no Delivery Days in it is
`NO_DATA`, keeps its previous rate, and is **not** flagged — an agency that was
sent no calls has not performed below the floor, it has not performed at all.

### Per agency, always

Every function takes a `tenantId` and every query carries it. Two agencies go
live — one with 45 licensed agents at roughly 450 delivered calls a day, one with
15 at roughly 150 — and their calls, applications, closing percentages, rates and
settlements never mix. Each agent's calls and applications roll up into their own
agency's totals and nowhere else.

---

## 2. The rate curve

The rate is a **continuous** function of closing percentage, interpolated between
anchor points. This is a deliberate change from an earlier step-banded design and
must not be "simplified" back. The reason is arithmetic, not taste:

At these volumes the measured closing percentage carries real sampling error —
roughly ±1.4 points at 450 delivered calls in a window, ±2.8 at the smaller
agency's 150. Band edges one point wide are narrower than that noise. On a step
scale an agency performing at exactly 10.0% sits on an edge where downward noise
is expensive and upward noise is free, and pays about **4% above its fair rate
purely from randomness**. A continuous curve makes small errors symmetric and
cuts that distortion to under 2% across the whole range.

### Anchor points (curve v1)

| closing % | rate |
| ---: | ---: |
| 5.0% | $264 |
| 6.0% | $234 |
| 7.0% | $204 |
| 8.0% | $184 |
| 9.0% | $169 |
| 10.0% | $159 |
| 11.0% | $159 |
| 12.0% | $149 |
| 13.0% | $144 |
| 14.0% | $139 |
| 15.0% | $134 |

Between two anchors, linear interpolation, rounded to the nearest dollar.

**At and above 15.0% the rate is $134** — the curve is flat, not extrapolated.
20% pays the same as 15%.

**Below 5.0% there is NO rate.** Not zero, not an extrapolation of the 5–6%
segment (which would quote $294 at 4% with nothing behind it). The agency is
flagged for review with a distinct status, Phase 3 pauses delivery on that flag,
and **only a platform admin can clear it**. An agency cannot clear its own.

### Versioned, not constants

The anchors are rows (`rate_curve_versions`, `rate_curve_anchors`), not constants
in code, because a change to them must never alter a rate already applied to a
completed settlement — and constants cannot promise that: the next deploy would
silently reprice every historical row that recomputes from them.

Every rating decision records the curve version that priced it. Publishing a new
version retires the previous one rather than editing it, so a settled day still
resolves against the curve that priced it. `POST /api/v1/platform/rating/curve`
is the only way to publish, and it is platform-staff only.

### The opening block — and there is no introductory rate

**Removed in Phase 3.** Phase 2 priced an agency with no rating history at $159
per application for its first five, configured as `introductoryRate` and
`introductoryApplications` on the curve version. That concept is gone: from the
engine, from `RateCurve`, from the summary, from the curve publish API and from
the portal. `countSubmittedApplicationsLifetime()` — the lifetime count that
decided when the package stopped applying — is deleted. Grep for
"introductory": what remains is two database columns and one enum member,
retired in place because migrations here are additive and never drop, and both
are documented as retired in `schema.prisma`.

An agency's opening rate and opening block are **agreed before its first
Delivery Day and recorded per tenant**. The rate is recorded by a platform admin
(`PUT /api/v1/platform/rating/agencies/:tenantId/opening`), which sets the
agency's status to `OPENING_BLOCK`; the block is sold and paid for through
`POST /api/v1/platform/delivery/agencies/:tenantId/opening-purchase`. An agency
cannot record either.

While an agency is in `OPENING_BLOCK` the engine records the measurement as
usual and **leaves the agreed rate in force** rather than repricing the agency
out from under the agreement. From the first settled Delivery Day the curve
governs.

An agency with no opening agreement at all has **no rate** — an em dash, not a
number nobody signed — and Phase 3's delivery gate refuses it with
`NO_OPENING_AGREEMENT`.

---

## 3. The rating engine

After the close of each calendar day, each agency's closing percentage is
recomputed over the **trailing 3 Delivery Days** and its rate derived from the
curve. That rate applies to the **next calendar day** — a rate applies to a
whole day, including one on which the agency takes no calls; it simply does not
earn at it then.

The window length is configurable (`rating_settings.windowDeliveryDays`,
default 3) as is how far back to look for those days
(`rating_settings.deliveryDayLookback`, default 60 calendar days).

### What is deliberately absent

- **No minimum call threshold.** An earlier draft required 250 delivered calls in
  the window; that existed to stop a thin sample falling off a band edge, and
  with a continuous curve there are no edges. Both launch agencies clear 450
  calls in a 3-day window regardless.
- **No band-movement rules.** There are no bands. The rate moves to whatever the
  curve returns. An earlier draft capped increases at one band per day;
  simulation showed that machinery changed the effective rate by under a dollar
  per application, and it does not apply to a continuous curve. Do not
  reintroduce it.

### The record

Every run writes one immutable `rate_changes` row:

| Column | |
| --- | --- |
| `tenantId`, `effectiveCalendarDay` | the agency and the calendar day the rate applies to |
| `windowStart`, `windowEndExclusive` | the span, which for a non-contiguous window is wider than the days |
| `windowDeliveryDays`, `windowDaysFound`, `windowDayKeys` | Delivery Days asked for, found, and which ones |
| `deliveredCalls`, `submittedApplications` | the two counts |
| `closingPct` | what they produce; null when there were no delivered calls |
| `curveVersionId`, `curveVersion` | which curve priced it |
| `previousRate`, `newRate` | before and after; `newRate` is null below the minimum |
| `status` | `APPLIED`, `BELOW_MINIMUM` or `NO_DATA` |

This is the row shown to an agency that disputes its price, so it is complete
enough to recompute the rate from itself.
`GET /api/v1/rating/history/:id/recompute` does exactly that, reading the row and
the curve version it names and touching no live data. A `matchesStoredRate:
false` would mean the record is not the record it claims to be.

Rows are never updated and never deleted. A correction is a later row.

`NO_DATA` exists so that a gap in the history always means "the engine did not
run", never "it ran and said nothing". An agency that was closed keeps its
previous rate and is **not** flagged: being closed is not performing below the
floor.

### The rate change and the rate in force are two different things

`rate_changes` always records what the **curve** returned for the window. That
is the measurement record, and it exists whatever commercial arrangement is in
force. What the agency is actually priced at is `agency_rating_states`, and
there are two cases where the two differ:

- **`OPENING_BLOCK`** — the agreed opening rate stands until the block's first
  Delivery Day is settled, as above.
- **An open review flag** — an agency below the minimum stays under review until
  a platform admin clears the flag. A recovered window does **not** un-flag it:
  "only a platform admin can clear it" would mean nothing if the next day's
  numbers could do it instead. The measurement is still recorded, so the
  operator reviewing the flag can see the recovery. Clearing the flag does not
  hand back a rate either — the next daily run prices from the curve, because a
  price set by a button press is not a price derived from a measurement.

### Idempotence

One decision per agency per effective day, enforced by a unique index on
`(tenantId, effectiveCalendarDay)`. A second run reports `alreadyRated` and
writes nothing, rather than producing a second, conflicting price. That is what
makes it safe to put on a cron.

**Amended in Phase 3.** That held for one run after another and not for two runs
starting together: both found nothing on the pre-read and both wrote, and the
loser of the unique index raised. With only a cron and a by-hand button calling
this, the race was theoretical. Phase 3's settlement calls it, and a settlement
that raises because another run was rating the same agency at the same moment is
an agency that does not get billed. So the constraint violation is now caught
and the existing decision returned. The index is still what decides; the engine
reads the answer it gave.

### Running it

```
pnpm --filter @hopwhistle/api rating:run                  # the day that just closed
pnpm --filter @hopwhistle/api rating:run -- --day 2026-09-07
pnpm --filter @hopwhistle/api rating:run -- --dry-run     # compute and print, write nothing
```

Intended schedule: a little after midnight Eastern, `5 0 * * *` in
America/New_York. `lastClosedBusinessDay()` reads the Eastern clock, so a run
that fires at 23:00 Eastern rates the *previous* day rather than one that still
has an hour left in it.

The engine lives in `apps/api` rather than `apps/worker` because the worker talks
to Postgres through raw `pg` and has no Prisma client; reimplementing the
arithmetic against raw SQL would give the platform two implementations of the
numbers Phase 3 bills from. `POST /api/v1/platform/rating/run` is the same run,
by hand, for platform staff.

---

## 4. What the agency sees

`/rating` in the agency portal, from `GET /api/v1/rating/summary`. Four numbers,
laid out so that no two of them can be read as each other:

| | |
| --- | --- |
| **Current rate** | dollars per submitted application, today. An em dash under review — there is no rate below the floor, and a `$0` renders as a price |
| **Rating window** | the trailing window percentage that *actually set* that rate, with the days it covers and both counts |
| **Today so far** | today's live closing percentage. Muted, and labelled "does not set today's rate" |
| **Tracking toward** | what tomorrow would be if today closed now. Muted and explicitly provisional |

An agency that reads "today so far" as the window percentage thinks its price
changed at 10am. An agency that reads "tracking toward" as the current rate
believes it is being paid something it is not. Both are shaped like a billing
dispute, which is why the four are separated and each is labelled with what it
does.

Below them, the rate history: every decision with its counts, its window days
and its curve version.

Phase 3 adds `/delivery` beside it — what is left on the block, today's overrun
and what it will cost tonight, the distance to the ceiling and the per-agent
closing percentages — and `/delivery/settlements`, the immutable record of what
was actually charged. See `docs/BILLING.md` §6.

Phase 4 makes a settlement row on that page **expand to how its rate was
derived**: the Delivery Days the trailing window covered with each day's call
and application counts, the totals they sum to, and the rate this module's own
`rateFor()` returns for that percentage — priced against the curve version the
settlement names rather than whichever is active now. It is the rating engine's
arithmetic shown back to the agency it was applied to, and when the
recomputation does not land on the stored rate the page says so rather than
hiding it. See `docs/BILLING.md` §6.

**No route accepts a rate, a price or a computed amount from the browser.** The
two places a number arrives from a caller are both platform-only and are inputs
to the pricing rather than assertions about it: the anchor points of a new curve
version, and an agreed opening rate.

---

## 5. Migration

`apps/api/prisma/migrations/20260908000000_add_rating_engine/migration.sql`.

The production database has **no `_prisma_migrations` table** and has never been
managed by `prisma migrate`; every migration to date was applied by piping its
SQL into psql by hand. This one is written for that:

```
psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260908000000_add_rating_engine/migration.sql
```

Additive only, idempotent (every statement is `IF NOT EXISTS` or inside a guarded
`DO` block), and safe against a schema that has drifted from `schema.prisma`. It
drops nothing and alters no existing column's type or nullability. Running it
twice is a no-op — verified.

It adds one nullable column and two indexes to existing tables, seven new tables,
and curve version 1 with its eleven anchors. `submittedAt` is backfilled for rows
already in `SUBMITTED` from `COALESCE(automationCompletedAt, updatedAt)`, guarded
on `IS NULL` so a re-run never moves a timestamp already set.

**Nothing was added to the deploy path.** In particular no
`prisma migrate deploy`: against an empty migration history it would try to
replay every migration from the beginning.

> **Flagged, not changed.** `scripts/deploy-netenroll.sh` — the ordered script
> written for the Phase 1b change — already runs
> `pnpm --filter @hopwhistle/api db:migrate:deploy` at step 2/5. Against the
> production database, which has no `_prisma_migrations` table, that is the
> failure mode described above; `.github/workflows/dialer-v2.yml` says as much
> in its own comments ("`prisma migrate deploy` from an empty database currently
> FAILS"). Phase 2 neither uses that script nor extends it, and this migration
> is deliberately not in its `REQUIRED_MIGRATIONS` list. It is recorded here
> because it is a live hazard on `main` that predates this work and should be
> dealt with on its own, not folded into a rating change.

---

## 6. Tests

| Suite | Cases | What it pins |
| --- | ---: | --- |
| `services/rating/__tests__/calendar-day.test.ts` | 14 | Eastern reckoning, the 23:59:59 boundary, both DST transitions, month/year/leap-day walks, weekday naming, a non-contiguous window spanning its gap, malformed input refused |
| `services/rating/__tests__/business-day.test.ts` | 19 | Weekends and all eleven federal holidays including observed days; Thursday + 5 Business Days ending the following Wednesday; a holiday inside a period extending it; the two counting readings kept apart; the three contractual periods |
| `services/rating/__tests__/rate-curve.test.ts` | 13 | Every anchor exactly; interpolation; flat at and above 15%; no rate below 5% and a rate exactly at 5%; continuity across 10%; monotonicity; a past settlement priced from its own version |
| `__tests__/rating-engine.test.ts` | 45 | Against a real database: the two counts, day attribution, Delivery Day windows for both agency schedules, two agencies rating independently, the immutable record recomputing to the same rate, the review flag, curve versioning, and the portal's four numbers |

The cases the brief names, and where they are:

- an application reaching submitted state twice counts once — `rating-engine.test.ts`, driven through the real `markAutomationCompleted`
- a call answered and immediately dropped counts as delivered — same file
- a call that rings unanswered does not — same file
- applications at 23:59:58 and 00:00:02 land on different days — same file
- two agencies running simultaneously produce independent closing percentages — same file
- each anchor returns its exact rate; a value between two returns the interpolated figure; 15% and 20% both return $134; 4.9% returns no rate and sets the flag — `rate-curve.test.ts` and `rating-engine.test.ts`
- a curve version change does not alter a past settlement — both files
- a rate change record recomputes to the same rate from its own stored values — `rating-engine.test.ts`
- an agency crossing below 5% gets the flag and no rate — same file
- two agencies with different volumes rate independently on the same day — same file, at the launch volumes (450/45 and 150/9)
- **an agency taking no weekend calls rates Monday off the prior Thu/Fri/Mon** — `rating-engine.test.ts` §4b
- **an agency taking weekend calls rates Monday off Sat/Sun/Mon** — same file, same section, on the other tenant in the same fixture
- **a five-Business-Day period starting Thursday ends the following Wednesday, not Monday** — `business-day.test.ts`
- **a federal holiday inside a Business Day period extends it by one day** — same file

```
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/hopwhistle_test \
  pnpm --filter @hopwhistle/api test
```
