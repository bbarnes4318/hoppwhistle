# The ledger, Overrun and daily settlement — Phase 3

Phase 2 made the numbers correct. This is what charges money against them:
off-session ACH debits, per agency, per Delivery Day, against real bank
accounts, with no refund path in the product. Every defect here is one a
customer sees on a bank statement.

Read `docs/RATING.md` first. Everything below calls the rating engine rather
than reimplementing any part of it — the closing percentage, the Delivery Day
window, the rate curve and the calendar are defined once, in Phase 2, and this
phase is a consumer of them.

**There are no refunds, credits, reversals, rebates or make-goods**, anywhere:
not in the schema, the API, the UI or the copy. A carrier's decision after an
application is submitted — issued, declined, rescinded, lapsed — never returns a
credit. There is no enum member for it, no column, and no code path. That is
asserted, not merely intended: `settlement.test.ts` reads the ledger's enum
labels out of `pg_enum` and expects exactly `PURCHASE`, `CONSUMPTION`,
`OVERRUN`.

**There is no introductory rate.** Phase 2 carried one — a flat price for an
agency's first five submitted applications. It is gone: from the engine, the
curve, the summary, the publish API and the portal. An agency's opening rate and
opening block are agreed before its first Delivery Day and recorded per tenant;
from the second Delivery Day the rate curve governs. See §8.

---

## 1. The ledger

`application_credit_ledger`. Append-only, per tenant, and the only source of a
balance.

    balance = SUM(quantity) WHERE "tenantId" = $1

There is no counter column here or anywhere else. A counter is wrong the first
time a write is retried or a job is re-run, and this number decides whether a
call is delivered and whether an application is billed tonight.

### Three kinds of row

| Type | `quantity` | Carries |
| --- | ---: | --- |
| `PURCHASE` | +N | the unit rate, the amount, the Delivery Day the block is **for**, the Stripe payment reference, and the rate curve version that priced it |
| `CONSUMPTION` | −1 | the application, the purchase lot it drew on, which unit of that lot, and the rate that lot was bought at |
| `OVERRUN` | 0 | the application and the Delivery Day. No rate: an overrun is priced that evening, and the settlement row for its Delivery Day is where that money is recorded |

An overrun does not move a balance because there was no balance to move.

### Append-only is a property of the database

`application_credit_ledger_append_only` is a `BEFORE UPDATE OR DELETE` trigger
that raises. Not "no code path mutates a balance" — the database refuses. A
correction is a later row.

The trigger cannot be expressed in `schema.prisma`, so it lives in the migration
**and** in `prisma/sql/db-push-constraints.sql`, which CI runs after every
`prisma db push`. `db-push-constraints.test.ts` asserts all three triggers are
installed, for the same reason it asserts the lead-reservation index: a missing
constraint is silent, and the suite that covers the race passes anyway.

### Two applications cannot spend the same credit

A consumption claims **a specific unit of a specific lot**. `(purchaseEntryId,
lotIndex)` is unique. Two applications reaching submitted state at the same
instant both compute the same next free index; Postgres admits one insert and
rejects the other, and the loser retries onto the next unit.

That is a constraint, not a check-then-act, and the test exercises the
constraint: `settlement.test.ts` runs two consumptions against a lot of one
concurrently and asserts one `CONSUMED` and one `OVERRUN`, then runs twenty
against a lot of twenty and asserts twenty distinct `lotIndex` values.

### An application costs one credit, ever

`applicationId` is unique across the whole table — not per type. An application
that reaches submitted state twice (a retried automation run, a replayed
completion, the reconciliation pass below) has one row: either the credit it
spent or the overrun it was recorded as, never both and never two.

This mirrors Phase 2's `submittedAt`, which is written once on the first
transition into `SUBMITTED` and carried forward on a retry. The two together are
what make a re-run cost nothing.

### Oldest lot first

Credits spanning purchases at different rates are consumed in the order they
were bought — by the Delivery Day the block was bought for, then by when the row
was written. The rate the credit was bought at is copied onto the consumption,
so the row values itself without a join and still reads correctly after a new
curve version is published.

### Credits never expire

Nothing scans for old lots. No purchase carries an expiry column. There is no
job that sweeps a balance.

### The reconciliation pass

The consumption hook runs inside `markAutomationCompleted`, immediately after
the application reaches `SUBMITTED`, and **outside** that update's transaction.
The carrier has already accepted the application by then; wrapping the ledger
write into the same transaction would let a ledger failure roll back a
submission that has already happened at the carrier.

It is also deliberately swallowed on failure, for the same reason — and that is
not lost money, because the settlement begins by writing a ledger row for every
application submitted on the Delivery Day that does not have one yet, before it
counts the day's overrun. The worst case is that the credit is spent tonight
rather than at the moment of submission. `settlement.test.ts` drives that path
with three applications and no ledger rows at all.

---

## 2. Overrun

Delivery does not stop when the prepaid balance hits zero. Applications beyond
the Daily Block are recorded as Overrun and billed that evening at the newly
calculated rate — the same rate that applies to the next Delivery Day.

### The ceiling

    overrun ceiling = floor(Daily Block x ceiling percentage / 100)

50% above the Daily Block for an agency with fewer than 10 consecutive
settlements free of failed or unpaid debits, 100% at or beyond 10. Both
percentages and the threshold are configurable per tenant on
`agency_billing_profiles`, and a platform admin can override the ceiling
outright.

Floored, not rounded: 45 × 1.5 is 67.5, and half an application does not exist.
Rounding it up would extend a credit nobody agreed to.

**The launch numbers, which this arithmetic reproduces exactly:**

| | agents | Daily Block | ceiling | overrun ceiling | maximum daily debit at $134 |
| --- | ---: | ---: | ---: | ---: | ---: |
| larger agency | 45 | 45 | 50% | `floor(45 × 0.5)` = **22** | `(45 + 22) × 134` = **$8,978** |
| smaller agency | 15 | 15 | 50% | `floor(15 × 0.5)` = **7** | `(15 + 7) × 134` = **$2,948** |

Those are the figures on the Insertion Orders. `maxDailyDebitFor()` computes
them, and `settlement.test.ts` asserts both to the dollar, so the number on the
contract and the number in the code come from one arithmetic.

### The consecutive-settlement count is derived, never incremented

Counted from the settlements themselves, ordered by Delivery Day, stopping at
the first that was not `SUCCEEDED` or `NOT_CHARGED`. A counter would be wrong
the first time a settlement was re-run or a payment status arrived out of order,
and this number decides how much credit is extended.

`PENDING` breaks the streak. A settlement that has not been paid yet is not a
settlement free of unpaid debits, and being wrong in that direction extends
*less* credit rather than more.

### At the ceiling, delivery stops for the rest of the Delivery Day

The gate refuses; a `delivery_hold_events` row is written once for that agency,
day and reason; the agency sees it in the portal with the time it happened; and
platform admins are notified once rather than once per refused call.

**A call already connected finishes normally.** Nothing in the gate writes to a
`Call` row, and no path in this codebase tears down a live channel on a billing
condition. The gate is consulted when a call is about to be *offered*.
`settlement.test.ts` puts a call in `ANSWERED` with no `endedAt`, reaches the
ceiling around it, and asserts the call is untouched while the gate has flipped
to refusing.

### Overrun is discretionary, and it is withdrawn from a debtor

`PUT /api/v1/platform/delivery/agencies/:tenantId/ceiling` reduces or withdraws
a ceiling at any time; `0` withdraws it entirely and `null` returns the agency to
the schedule. Nothing an agency can reach sets it — an agency OWNER attempting it
gets 403 and the row does not move.

Separately and automatically: **no overrun at all is extended to an agency with
an unpaid settlement.** Not reduced — withdrawn, to zero, derived from the
settlements rather than by editing the profile. Delivery holds at the current
paid balance, which is what the agency has already bought and which nothing
takes away.

---

## 3. Delivery gating

One function — `services/billing/delivery-gate.ts` — and every path that offers
a call to an agent calls it. A gate written twice is a gate that disagrees with
itself, and the half that says yes is the one that bills somebody.

### The conditions, in the order they are checked

The order is severity, not convenience: an agency that is suspended *and* at its
ceiling should be told it is suspended, because that is the thing a human has to
act on.

| Reason | Meaning |
| --- | --- |
| `ADMIN_SUSPENDED` | a platform admin suspended the account |
| `NO_MANDATE` | no valid ACH mandate. No mandate, no delivery |
| `BELOW_MINIMUM_CLOSING` | the trailing window closed below 5.0%. Only a platform admin clears it |
| `SETTLEMENT_UNPAID` | a settlement is unpaid past its grace period |
| `NO_OPENING_AGREEMENT` | no opening rate and block were ever agreed, so there is no price and nothing has been bought |
| `CEILING_REACHED` | the balance is spent and today's Overrun has reached the ceiling |

Nothing here reads a stored "paused" flag. Every condition is recomputed from
the rows that decide it, because a stored flag is stale the instant a settlement
fails or the last credit is spent, and the direction it goes stale in is the one
that keeps delivering calls to an agency that should have stopped.

`delivery_hold_events` rows are a **record**, not the decision. The unique index
on `(tenantId, deliveryDay, reason)` is also the notification de-duplication:
the insert either wins and sends, or loses and does not.

### An unreadable gate refuses

If the database cannot be read we cannot tell whether this agency has credit,
and the two ways to be wrong are not symmetric. Refusing a call that was paid
for loses the agency a sale it had bought; delivering one it had not is a charge
we cannot substantiate. Both are bad, and the second is the one that ends up on
a bank statement.

### The paths — every one that was found, and what was done with it

**Gated.**

| Path | File | What the refusal looks like |
| --- | --- | --- |
| `GET /api/v1/freeswitch/lookup` — **Redis RTB lease branch** | `routes/did-routes.ts` | `{reject: true, reason: "DELIVERY_PAUSED", deliveryHoldReason}` |
| `GET /api/v1/freeswitch/lookup` — **`DidRoute` branch** | `routes/did-routes.ts` | same, and checked **before** buyer selection, so an agency at its ceiling never reaches the fallback that rings every extension on the campaign |
| `POST /api/v1/agent/call/incoming` | `routes/agent-phone.ts` | `403` with `deliveryHoldReason`, and **no `Call` row is created** |
| flow action `buyer.route` | `services/flow-engine.ts` | the action returns without publishing `call.buyer.route`; a `call.delivery.held` event is published instead |

`reject: true` is the shape `apps/freeswitch/scripts/inbound_route.lua` already
hangs up on, and it hangs up **before answering**. That matters for the
measurement: a refused call never gets an `answeredAt`, so it never enters the
delivered-call denominator — which is correct, because we did not deliver it.

The refusal on `POST /api/v1/agent/call/incoming` deliberately creates no `Call`
row. A TCPA block writes one because a blocked litigator is a compliance record
somebody may have to produce; a delivery hold is already recorded once per
Delivery Day, and a row per refused call would put hundreds of `RINGING` calls
that were never offered to anybody into the agency's call history.

**Examined and deliberately not gated.**

| Path | Why not |
| --- | --- |
| `POST /api/v1/agent/call/:callId/answer` | the agent picking up a call the gate already allowed. Refusing here would cut off a ringing call mid-offer and would contradict "a call already connected finishes normally" |
| `POST /api/v1/freeswitch/cdr` | records a call that has already happened |
| `POST /api/v1/agent/call/originate` | the agency's own **outbound** dialling. Not NetEnroll delivery, and excluded from the Phase 2 denominator by `direction: INBOUND` |
| `apps/worker` autodialer / hopper, `apps/dialer-v2` | outbound dialers, same reason |
| `routes/lead-inject.ts` | broadcasts lead **data** over SSE. Not a call |
| `services/insurance-lead-delivery.ts`, `insurance-lead-bulk-delivery.ts` | posts lead records to buyers. Not a call |
| `services/routing.ts` `selectBestBuyer` | a selection helper *below* the two gated callers. Gating there would sit underneath `did-routes`' "ring every campaign extension" fallback, so the gate is above it instead |
| `routes/freeswitch-mock.ts` `/api/v1/numbers/lookup` | a mock returning a hard-coded zero-uuid tenant. Not a production delivery path |

`delivery-gating-paths.test.ts` drives the two HTTP paths against a real
database and asserts both the allow and the refuse, including that the
FreeSWITCH internal-key guard still runs first — gating delivery must not have
opened those callbacks to anyone who can reach nginx.

### Paused is not terminated

Nothing in the gate writes to the ledger. Paid applications survive every pause
untouched and are available the moment the condition clears, because the balance
is the sum of rows nobody removed. Four separate tests assert the balance is
unchanged across a suspension, a missing mandate, a below-minimum pause and a
failed settlement.

An agency below 5% **cannot resume itself**. The review flag is cleared by a
platform admin and by nobody else; a recovered window does not clear it, which
is Phase 2's rule and is unchanged here.

---

## 4. Daily settlement

After each Delivery Day closes, per tenant, in this order:

0. **Reconcile.** Write a ledger row for every application submitted that day
   that does not have one, so the day's overrun is a count of what happened
   rather than of what got written.
1. **Count.** The day's Delivered Calls and Submitted Applications, from the
   Phase 2 definitions.
2. **Rate.** Call `rateAgencyForClosedDay()` — the Phase 2 engine — for the
   trailing-window closing percentage and the next day's rate. Not
   reimplemented: there is one rate curve on this platform.
3. **Bill the overrun** at that rate.
4. **Sell the next Delivery Day's block** at that rate, in the agency's
   configured daily target quantity, reduced by whatever paid applications
   remain unused, and omitted where the reduction takes it to zero.
5. **Charge both as a single off-session ACH debit.**
6. **Write the settlement record.**

### Idempotency is the requirement that matters most

The unique index on `daily_settlements (tenantId, deliveryDay)` is the whole
mechanism, and it is deliberately not a check-then-act:

    A.  INSERT the settlement, with every computed figure, status PENDING.
        A second run racing the first LOSES this insert and stops. It does not
        look first and then decide; it tries, and the database decides.
    B.  Charge, OUTSIDE that transaction, with the settlement id as Stripe's
        idempotency key.
    C.  Record the outcome, and on success write the purchase that sells
        tomorrow's block.

So two concurrent runs for one tenant and day produce one settlement row, one
charge and one block. The test starts them together, with latency in the fake
gateway so the race has a window, and asserts **the gateway was called once** —
not that a flag the code sets about itself says so.

A process that dies between A and B leaves a `PENDING` settlement with no
attempts. That is **not** resumed by an ordinary re-run, which would reopen the
race the insert closes; `resumeStalledSettlements()` handles it, touching only
rows old enough that no run can still be in flight, and charging with the same
idempotency key so Stripe returns the same payment intent rather than a second
debit.

The Phase 2 rating engine needed one change to make this hold. Its idempotency
was a pre-read: correct for a re-run, silent for two runs starting together,
which both found nothing and both wrote. It now catches the unique-constraint
violation and returns the existing decision. The index was always what decided;
the engine now reads the answer it gave instead of raising — because a
settlement that fails because another run was rating the same agency at the same
moment is an agency that does not get billed.

### The settlement record is immutable

`daily_settlements_figures_immutable` is a `BEFORE UPDATE` trigger that raises
if any of the twenty-one computed columns changes. The only fields that advance
afterwards are the payment lifecycle, and every transition of those is also an
appended `settlement_payment_attempts` row — itself append-only.

An agency disputing a charge is answered from the row, so the row has to still
say what it said on the night. It carries: the date, the two counts, the
trailing-window closing percentage and the days it covered, the rate, the curve
version, the `rate_changes` row it priced from, the overrun quantity and amount,
the configured block quantity, the unused paid applications, the next block
quantity and amount, the total charged, the maximum daily debit in force, the
payment status and the grace period.

`curveVersion` is null beside a non-null `rate` in exactly one case, and it
means something: the window closed **below the curve's minimum**, so there was no
next-day price to derive. The curve is never extrapolated downward to invent
one. Tonight's overrun is still owed, so it is billed at the rate in force on the
Delivery Day it was incurred on — the rate that day's credits were sold at,
which is a number both sides already agreed and which is stored on the purchase
row — and **no block is sold**, because delivery is paused on the review flag and
selling an agency a block it cannot use would be taking money for nothing.

### One agency failing must not stop another

`runDailySettlement()` settles tenants one at a time and collects failures.
Their ledgers, rates and payment instruments are independent, and a bad row for
one must not leave the rest unbilled. Two tests cover it: one where the second
agency has no billing profile at all, and one where both settle for real and the
figures are asserted to differ.

### Running it

```
pnpm --filter @hopwhistle/api settlement:run                      # the day that just closed
pnpm --filter @hopwhistle/api settlement:run -- --day 2026-09-07
pnpm --filter @hopwhistle/api settlement:run -- --tenant <id>
pnpm --filter @hopwhistle/api settlement:run -- --dry-run         # compute and print, charge nobody
pnpm --filter @hopwhistle/api settlement:run -- --retry-failed
pnpm --filter @hopwhistle/api settlement:run -- --resume-stalled
```

Intended schedule: a little after midnight Eastern, after the rating run —
though it does not depend on that ordering, because it calls the rating engine
itself and that engine is idempotent.

```
5  0 * * *   rating:run       (America/New_York)
15 0 * * *   settlement:run   (America/New_York)
```

`--dry-run` is a **separate read-only path**, not the real one with a flag
threaded through it. A dry run that shares the write path with the real run is
one `if` away from charging somebody.

`POST /api/v1/platform/delivery/settlement/run` is the same run, by hand, for
platform staff. Its body carries a Delivery Day and optionally which agencies,
and nothing else — a body carrying `totalCharged`, `rate` or `amount` changes
nothing, which is asserted.

---

## 5. Payment

ACH debit, off-session, against a saved mandate.

### One Stripe integration

`apps/worker/src/services/stripe-service.ts` holds the platform's only
`new Stripe(...)`, its only API key read, and now its only ACH code. It was
extended in place; nothing was duplicated.

`apps/api` reaches it through the `@hopwhistle/worker/stripe-service` workspace
export. `apps/api/src/services/billing/ach.ts` contains **no Stripe calls at
all** — it declares the shape the settlement needs and hands back that class. A
second integration would be two places to get an idempotency key wrong, and only
one of them would be the one somebody fixes.

Three mechanical notes on that wiring:

- The worker's `Pool` is now built on first use rather than in the constructor,
  so importing the class from `apps/api` does not open a second connection pool
  or throw in a process with no `DATABASE_URL`.
- `apps/api/tsup.config.ts` sets `noExternal: [/@hopwhistle\/.*/]`, so the module
  itself is inlined into `dist/index.js`. **`stripe` is pinned external there**,
  and that is load-bearing rather than tidy: inlining it drags in `qs` →
  `side-channel` → `object-inspect`, which are CommonJS and call
  `require("util")` at import time, and esbuild's CJS shim answers that with
  `Error: Dynamic require of "util" is not supported` — thrown while the server
  starts, after a green build. `stripe` is a direct dependency of `apps/api` so
  Node resolves it from the node_modules the runner image already copies.
- `apps/api/Dockerfile`'s deps stage gained one `COPY apps/worker/package.json`
  line, without which `pnpm install` cannot resolve the workspace dependency.

### Card is for the opening purchase and nothing else

`chargeAchOffSession` sets `payment_method_types: ['us_bank_account']` and
nothing else. At roughly $8,978 a day on one account, card fees would run about
$87,000 a year, so the daily debit is ACH-only. `chargeCardOnSession` exists for
an agency's opening purchase, is named so it cannot be reached for a settlement
by accident, and is called from exactly one route.

### The maximum daily debit is a commitment, not a guideline

If a computed settlement exceeds the agency's configured maximum, **nothing is
sent to Stripe**. The settlement is written as `HALTED_MAX_DEBIT` with every
figure intact so a human can see exactly what would have been charged, no block
is sold, and platform admins are alerted. It is not clamped to the maximum and
charged: a figure on an Insertion Order is not a rounding instruction.

The alert goes to platform staff only. Telling an agency it was nearly
overcharged before anybody has looked at why is not information, it is alarm.

### The mandate is read from Stripe, never from the browser

`POST /api/v1/delivery/mandate/setup-intent` creates a `us_bank_account`
SetupIntent and returns its client secret — which authorises attaching a bank
account to this agency's customer and nothing else. It names no amount.

`POST /api/v1/delivery/mandate/confirm` takes a SetupIntent id and **nothing
else**. Every fact written — the payment method, the bank, the last four,
whether it is usable at all — is read back from Stripe by the server. A browser
saying "I attached bank account X" is a browser choosing which bank account a
five-figure daily debit comes out of. The SetupIntent's customer is also
compared to the agency's own, so one agency cannot confirm another's.

Only a `succeeded` SetupIntent produces an `ACTIVE` mandate. Anything else —
`requires_action`, `processing`, a micro-deposit awaiting confirmation — is
`PENDING_VERIFICATION`, and an agency with one is not delivered to.

### Failed settlement

Delivery holds at the current paid balance, no block is sold, and the agency and
platform admins are notified once — keyed on the settlement, so three retries of
one failure send one notice.

`retryFailedSettlements()` re-attempts once per calendar day until the grace
period ends. Each retry is a genuinely new debit, with a later attempt number and
therefore a different idempotency key, because a declined ACH debit is not
reattempted by Stripe on its own.

The grace period is **five Business Days** — Monday to Friday excluding US
federal holidays — from the Delivery Day that failed, and it starts at the first
failure and is not extended by a retry. It is `businessDayPeriodEnd()` from
Phase 2, which counts the start day as day one.

This is the Business Day definition, not the Delivery Day one, and getting it
wrong is invisible: a shortened deadline is not an error message, it is just an
earlier date. The test pins a real case — a Friday 2026-09-04 failure, with
Labor Day on the Monday inside the period, expires on **Friday 2026-09-11**.
Read as calendar days it would expire on Tuesday the 8th and delivery would stop
three days early.

Unpaid past the grace period, delivery stops entirely. The paid balance is still
not taken away.

### No figure comes from the browser

Every amount, rate and quantity the settlement charges is derived server-side
from the ledger and the rating engine. Four numbers do arrive from a caller, all
four platform-only, all four audited, all four **inputs** to the pricing rather
than assertions about it:

- an agency's Daily Block quantity,
- its maximum daily debit,
- its Overrun ceiling percentage,
- the quantity and rate of an opening purchase that was commercially agreed.

An agency OWNER is refused every one of them.

---

## 6. What the portal shows

### The agency principal — `/delivery`

Live, refreshed every thirty seconds. Calls routed and calls answered; today's
applications, split into those on the block and those in overrun; **today's
closing percentage and the trailing-window figure, in separate cards, each
labelled with what it does**; applications remaining on the block; overrun so far
and the dollars it will cost tonight; distance to the ceiling; the current rate;
the rate tomorrow is tracking toward; and the projected total charge at
settlement.

The two closing percentages are the thing most likely to start an argument. An
agency that reads "today so far" as the window figure thinks its price changed at
10am. The window card names the Delivery Days it covers, so the agency can
reconstruct it — an agency that cannot reconstruct its own window cannot check
its own price.

The two rates are the same trap, and "tracking toward" is muted and explicitly
provisional.

When delivery is paused the page says so, says why, says when it stopped, and
says how many paid applications are waiting.

### The per-agent table — same page

Calls taken, applications, closing percentage, talk time, availability and
current status, sortable on every numeric column and sorted by closing
percentage by default. This is the screen a principal decides who needs coaching
from.

Calls are attributed by `answeredByUserId`, a column added in this phase and
backfilled from the metadata key the answer handler has always written. A
delivered call can still have no agent on it, and those rows appear as a single
**Unattributed** row rather than being dropped — a per-agent table that quietly
loses ten percent of the day is a table somebody makes a coaching decision from.
The test asserts the rows sum to the agency total.

Availability is talk time as a share of the agent's recorded working hours, from
the payroll time entry for the day. When hours were not recorded it is an em
dash, never 0%.

### Settlement history — `/delivery/settlements`

One row per settled Delivery Day carrying every figure from the settlement
record, and the same columns as CSV. Nothing is summarised away and nothing is
recomputed in the browser.

The CSV guards cells beginning `=`, `+`, `-` or `@` so a spreadsheet does not
evaluate them.

### An agent's own view — `/delivery/me`

Their calls, applications and closing percentage against the agency average.
**No pricing and no money**, and that is a property of the endpoint rather than
of the page: `GET /api/v1/delivery/me` loads no rate, balance, overrun or
charge, so there is nothing to accidentally render. The test serialises the
response and asserts the words are not in it.

### Platform admin, cross-agency — `/admin/agencies`

Per agency for one Delivery Day: calls, applications, closing percentage, rate,
revenue, call cost, margin, revenue per call and cost per call. Flags needing
action — below 5% and paused, at ceiling, failed or unpaid settlement, no valid
mandate, suspended — with flagged agencies sorted to the top. Settlement run
status per agency: settled, failed, or not yet run. And a button to run the
settlement, which is safe to press twice.

Every figure is computed per agency. There is no pooled cross-tenant aggregate
anywhere on it.

---

## 7. Tenant isolation

Nothing in Phase 1 or 1b was relaxed. `lib/tenant-context.ts` is unchanged, and
every agency-scoped route added here resolves its tenant through it and takes no
parameter naming an agency.

Every platform route is gated on `requirePlatformAdmin`, and the `:tenantId` in
those paths names **the agency being administered**, not the acting tenant of
the caller — the same shape as `quotas.ts`. Authority comes from the capability.

`settlement.test.ts` asserts an agency sees no other agency's settlements, is
refused the cross-agency view, is refused the settlement run, and cannot raise
its own ceiling.

---

## 8. The introductory rate is gone

Phase 2's curve carried `introductoryRate` and `introductoryApplications` — a
flat $159 for an agency's first five submitted applications — and the engine
counted a lifetime total of applications to decide when it stopped applying.

All of it is removed:

| Was | Now |
| --- | --- |
| `RateCurve.introductoryRate` / `.introductoryApplications` | not on the type; `toRateCurve` does not read the columns |
| `countSubmittedApplicationsLifetime()` | deleted |
| `AgencyRatingState.introductoryApplicationsUsed` written every run | not written |
| `RatingSummary.introductory` | not on the response |
| `POST /api/v1/platform/rating/curve` **required** both fields, 400 without them | neither accepted; a curve is its anchors |
| `/rating` showed "Introductory rate: $159 … for the first 5" | removed |
| a missing rating state defaulted to `INTRODUCTORY` at $159 | no state means **no rate** — an em dash — and the gate refuses with `NO_OPENING_AGREEMENT` |

The database keeps the columns and the `INTRODUCTORY` enum member. Migrations
against the production database are applied by piping SQL into psql by hand and
are additive only: dropping a column is the one thing they must never do, since
a column that turns out to have been wanted cannot be un-dropped. The columns
get `DEFAULT 0` instead, so a curve can be published without supplying a number
nobody reads, and the schema comments say plainly that they are retired.

An agency's opening rate and opening block are agreed before its first Delivery
Day and recorded per tenant — the rate through
`PUT /api/v1/platform/rating/agencies/:tenantId/opening`, the block through
`POST /api/v1/platform/delivery/agencies/:tenantId/opening-purchase`. From the
second Delivery Day the rate curve governs.

---

## 9. Migration

`apps/api/prisma/migrations/20260910000000_add_billing_ledger_and_settlement/migration.sql`

The production database has **no `_prisma_migrations` table** and has never been
managed by `prisma migrate`. This one is written for the way every migration to
date was applied:

```
psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260910000000_add_billing_ledger_and_settlement/migration.sql
```

Additive only, idempotent (every statement is `IF NOT EXISTS` or inside a guarded
`DO` block), and safe against a schema that has drifted from `schema.prisma`. It
drops nothing. It alters no existing column's type or nullability — the only
`ALTER`s add one nullable column and two `DEFAULT`s. Running it twice is a no-op,
verified.

It adds:

- `calls.answeredByUserId` (nullable) and an index, backfilled from the
  `metadata->>'answeredByAgentId'` key the answer handler has always written,
  guarded on the id existing in `users` so a stale value cannot create a
  per-agent row for somebody who is not an agent of that agency;
- `DEFAULT 0` on the two retired introductory columns;
- five enums, six tables and their indexes and foreign keys;
- three triggers: the ledger's append-only guard, the settlement's immutability
  guard, and the payment attempts' append-only guard.

The three triggers are repeated verbatim in `prisma/sql/db-push-constraints.sql`,
which CI runs after `prisma db push` — `db push` builds from `schema.prisma`,
which cannot express a trigger, so without that file every database CI and every
developer works against would silently permit an UPDATE that moves a balance.

**Nothing was added to the deploy path.** In particular no
`prisma migrate deploy`: against an empty migration history it would try to
replay every migration from the beginning. The pre-existing hazard recorded in
`docs/RATING.md` §5 — `scripts/deploy-netenroll.sh` calling
`db:migrate:deploy` — is unchanged and still not something this phase uses.

Zero drift is verified rather than assumed: the migration was applied to a
database with the six tables removed, and `prisma migrate diff` against
`schema.prisma` reported **no difference detected**.

---

## 10. Tests

```
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/hopwhistle_test \
TEST_REDIS_URL=redis://localhost:6379/1 \
  pnpm --filter @hopwhistle/api test
```

| Suite | Cases | What it pins |
| --- | ---: | --- |
| `__tests__/settlement.test.ts` | 39 | the ledger, the ceiling, the gate, the settlement, the portal, and the absence of refunds — against a real database |
| `__tests__/delivery-gating-paths.test.ts` | 7 | that every delivery path actually asks the gate, driven through the real route handlers |
| `__tests__/db-push-constraints.test.ts` | +3 | the three triggers are installed |

The cases the brief names, and where they are:

- **settlement run twice concurrently for one tenant and day: one charge** —
  `settlement.test.ts`, "charges once when the run is started twice
  concurrently". Two runs started together with latency in the gateway;
  asserts one gateway call, one settlement row, one purchase, one attempt.
  A sequential repeat is asserted separately.
- **concurrent consumption of the last credit: one credit spent** — "spends
  exactly one credit when two applications submit simultaneously", and again at
  twenty writers against twenty credits.
- **ceiling reached mid-day with a call connected: that call completes, no new
  calls** — "keeps delivering when the balance hits zero, and stops at the
  ceiling". A call in `ANSWERED` with no `endedAt` is asserted untouched.
- **ACH failure: delivery holds, agency and admins notified, no second block
  sold** — "holds delivery, notifies and sells no block when the debit fails".
- **agency crossing below 5%: delivery pauses, paid applications survive** —
  "pauses delivery below 5%, and the paid applications survive", including that
  the agency cannot clear its own flag and that the balance is intact after a
  platform admin does.
- **two agencies settling the same night: independent; one failing does not
  block the other** — two tests, one where the second agency cannot settle at
  all and one where both settle with different figures.
- **a settlement exceeding the maximum daily debit: halted, not charged** —
  "halts without charging when the total exceeds the maximum daily debit".
  Asserts the gateway was never called and no block was sold.
- **an application reaching submitted state twice: one credit, one charge** —
  "costs one credit when an application reaches submitted state twice", driven
  through the real `markAutomationCompleted`, called three times.

Also asserted: the ledger refuses `UPDATE` and `DELETE`; a settlement's figures
refuse to change; oldest-lot-first across two rates; the Insertion Order figures
`$8,978` and `$2,948`; the Business Day grace period across Labor Day; that no
refund enum member exists; that a carrier declining after submission returns
nothing; and that an agency cannot reach any platform surface.

Full API suite at the time of writing: **746 passed** (was 697; +49). Typecheck
errors unchanged at 80; web typecheck unchanged at 127; no new lint findings.
