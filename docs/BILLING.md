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
`OVERRUN`, `DRY_RUN_CLOSEOUT`.

The fourth is not an exception to that. `DRY_RUN_CLOSEOUT` retires credits a
**dry-run** settlement issued — credits that were never sold, never invoiced and
never paid for, created only so an agency could keep delivering while its
numbers were being watched. No money moves in either direction, which is why
those rows carry a null `amount`, and nothing is returned to anybody, because
nothing was taken. See §0c.

**Billing is opt-in, per agency, and off by default.** Nothing below applies to
an agency until a platform admin explicitly enrols it. See §0 — it is first
because it is what decides whether any of the rest happens at all.

**Taking an agency live is §0d, the go-live runbook**: the ordered steps from
unenrolled to charging, what to check after each one, and what reverses it.
Follow it rather than reasoning from the rest of this document.

**There is no introductory rate.** Phase 2 carried one — a flat price for an
agency's first five submitted applications. It is gone: from the engine, the
curve, the summary, the publish API and the portal. An agency's opening rate and
opening block are agreed before its first Delivery Day and recorded per tenant;
from the second Delivery Day the rate curve governs. See §8.


---

## 0. Enrolment — the opt-in

An agency is subject to the billing system **only** when a platform admin has
explicitly enrolled it. Unenrolled is the default, and unenrolled means
untouched:

| | unenrolled | enrolled |
| --- | --- | --- |
| delivery gate | not consulted; calls deliver exactly as they did before Phase 3 existed | every condition in §3 applies |
| submitted applications | no ledger row of any kind — not a consumption, not an overrun | metered per §1 |
| nightly settlement | skipped entirely; **no settlement row**, not even one saying zero | settled per §4 |
| `delivery_hold_events`, notifications | never written | per §3 |
| the portal | "Billing is not enabled for this agency" | the panel in §6 |
| the cross-agency view | shown as `not enrolled`, carrying **no flags** | flagged per §6 |

### Why this exists

Phase 3 shipped without it, and it was a production-stopping defect. The gate
refuses an agency with no valid ACH mandate; an agency with no billing profile
has no mandate; so every existing tenant would have been refused with
`NO_MANDATE` the moment the gate went live — five of them in production, none
with a profile, one carrying live client traffic.

An opt-in that can be arrived at accidentally is not an opt-in. So enrolment is
`agency_billing_profiles.billingEnrolledAt`, set by an explicit act and null
otherwise. It is **not** inferred from the existence of that row, from a
mandate, or from ledger rows.

### The migration enrols nobody

`20260911000000_add_billing_enrolment/migration.sql` adds the columns nullable
or with a safe default and contains no `UPDATE` that sets an enrolment anywhere.
Applying it leaves every existing tenant unenrolled, ungated, unmetered and
unsettled.

That is asserted rather than read: `settlement.test.ts` §0 seeds tenants shaped
like the production ones — calls, applications, no billing profile — against a
database the migration has actually been applied to, and checks that the gate
returns `enrolled: false, allowed: true` for each, that no hold event exists,
that no notification was sent and that the ledger is empty.
`delivery-gating-paths.test.ts` does the same through the real HTTP routes,
using conditions that *do* refuse an enrolled agency (a suspension, a missing
mandate, no terms at all) so a pass means the gate is genuinely not applied
rather than applied and saying yes.

### The gate checks it first, and on its own

`evaluateDeliveryGate` reads enrolment before anything else, in its own query
rather than as part of the `Promise.all` with the ledger and settlement reads.
That ordering is deliberate twice over: an unenrolled agency is short-circuited
before any billing state is touched, and — because an unreadable gate refuses
(§3) — its calls cannot stop because a query about a billing system it is not in
failed.

### Enrolling an agency

    GET  /api/v1/platform/delivery/agencies/:tenantId/enrolment   check first
    POST /api/v1/platform/delivery/agencies/:tenantId/enrol
    POST /api/v1/platform/delivery/agencies/:tenantId/unenrol

Platform-only; an agency OWNER gets 403 on all three and the row does not move.

Enrolment is **refused** unless all of these are already in place, and the
refusal names every missing one at once rather than one per attempt:

| Blocker | Why it must be there first |
| --- | --- |
| `NO_BILLING_PROFILE` | everything else is read off it |
| `NO_DAILY_BLOCK` | a block of zero means every application is Overrun and the ceiling is zero, so delivery stops on the first application |
| `NO_MAX_DAILY_DEBIT` | a maximum of zero halts every settlement |
| `NO_OPENING_RATE` | no price: the gate refuses with `NO_OPENING_AGREEMENT` and the settlement has nothing to bill overrun at |
| `NO_VALID_MANDATE` | no mandate, no delivery — enrolling without one stops the agency immediately |

The reason for checking is the same reason the switch exists. Enrolment takes
effect on the next call offered, so enrolling an agency that fails any of these
reproduces the original failure one step later and with somebody's name on it.

Un-enrolling stops the gating, the metering and the settling immediately. It
does **not** touch the ledger or the settlements already written: those are the
record of what the agency was charged, and nothing in this system removes them.

### The order to onboard an agency in

1. `PUT  /api/v1/platform/delivery/agencies/:id/terms` — Daily Block, maximum daily debit
2. `PUT  /api/v1/platform/rating/agencies/:id/opening` — the agreed opening rate
3. the agency completes the ACH mandate (§5)
4. `POST /api/v1/platform/delivery/agencies/:id/opening-purchase` — the opening block
5. `GET  /api/v1/platform/delivery/agencies/:id/enrolment` — confirm `readyToEnrol`
6. `POST /api/v1/platform/delivery/agencies/:id/enrol`
7. watch settlements compute with no money moving (§0b)
8. invoice that period by hand from the export (§0b)
9. `PUT  /api/v1/platform/delivery/agencies/:id/charges` `{enabled: true}` — which
   also retires the dry run's credits (§0c)
10. sell the first paid block for the cutover day

**Do not work from this list.** It is the shape of the thing; §0d is the
runbook, with the verification to run after each step and the call that reverses
it. Three of these steps cannot be reversed, and the list above does not say
which.

---

## 0b. The dry run — everything except the debit

Charging is a **second** switch, `agency_billing_profiles.chargesEnabled`, also
false by default. An agency that is enrolled but not charging gets the whole
settlement — the reconciliation, the counts, the rating call, the overrun, the
next day's block, the full immutable record — and no Stripe charge. The row
reads `paymentStatus: DRY_RUN` and `totalCharged` is exactly what it would have
taken.

So the first thing that happens to a newly enrolled agency is settlements that
compute and record without moving money, for as many days as you want to watch.

    PUT /api/v1/platform/delivery/agencies/:tenantId/charges  {"enabled": true}

Refused for an agency that is not enrolled — there would be nothing to charge.

### What the dry run does and does not do

- **Does** write the settlement row, with every figure real.
- **Does** sell the next Delivery Day's block. Deliberately: not selling it
  would leave the agency at a zero balance, every application would be Overrun,
  and delivery would stop at the ceiling on the first day — so the thing being
  watched would not be the system's real behaviour. The purchase carries **no
  Stripe payment reference** and names a `DRY_RUN` settlement, which is what
  makes an unpaid block identifiable later.
- **Does** still halt on the maximum daily debit. A dry run exists to show what
  would happen, and reporting `DRY_RUN` for a settlement that would have
  `HALTED_MAX_DEBIT` hides the one outcome somebody watching most needs to see.
- **Does not** write a payment attempt row — none was attempted.
- **Does not** send a failure notification — nothing failed.
- **Does not** count as a clean settlement. Ten dry-run days must not raise the
  Overrun ceiling to 100%: nothing was paid, and the ceiling is credit extended
  on a payment history that does not exist yet.

### Invoicing the dry run

The dry run is invoiced **by hand**. At 45 applications a day the larger agency
generates $6,030 of production daily, so a period spent watching numbers is not
a period given away. The settlement record is written to be enough to invoice
from on its own, and there is an export that hands it over as a file:

    GET /api/v1/platform/delivery/settlements.csv?from=&to=&mode=&tenantId=

Platform staff only; an agency principal gets 403. `from` and `to` are inclusive
Delivery Days (`YYYY-MM-DD`); a malformed one is a 400 rather than the whole
table. `mode` is `DRY_RUN`, `CHARGED` or `ALL` (the default).

Every column is on the row it came from — nothing is recomputed and nothing is
summarised away:

| column | |
| --- | --- |
| `agency`, `tenant_id` | who to invoice |
| `delivery_day` | the day being billed |
| `delivered_calls`, `submitted_applications` | the two counts |
| `day_closing_pct` | that day's closing percentage |
| `window_closing_pct`, `window_delivery_days`, `window_days_found`, `window_day_keys` | the trailing window that set the rate |
| `rate`, `curve_version` | the price and the curve version that produced it |
| `overrun_quantity`, `overrun_amount` | Overrun billed |
| `configured_block_quantity`, `unused_paid_applications`, `next_block_quantity`, `next_block_amount` | the block sold |
| `total_charged`, `max_daily_debit` | what was, or would have been, taken |
| `payment_status`, `stripe_payment_intent_id`, `paid_at`, `grace_period_ends_on`, `computed_at` | what happened to it |

`day_closing_pct` is **derived** from the two counts on the row rather than
stored beside them: it is exactly `submitted_applications / delivered_calls`, and
a second stored copy of a number is a second thing that can disagree with the
first. It is not the same number as `window_closing_pct`, which is the trailing
window that set the rate, and both are present under names that say which.

`mode=CHARGED` means every status **except** `DRY_RUN` — including `FAILED` and
`HALTED_MAX_DEBIT`. Charging was in force on those days; leaving them out would
make a reconciler think the day was never settled at all.

Cells beginning `=`, `+`, `-` or `@` are quoted and prefixed, so an agency name
does not reach a finance team as a spreadsheet formula.

### The two flags on the settlement job

Do not confuse them. They are both safe, but they are not the same:

| | writes | charges |
| --- | --- | --- |
| `--plan-only` | **nothing** — a preview, printed | no |
| `--settle-without-charge` | **everything** — the settlement row and the block | no |

These were `--dry-run` and `--no-charge`: two flags one character apart, where
one writes nothing and the other writes everything except the debit. That is a
typo with a bank statement at the end of it, at eleven at night, on a command
that debits real accounts. They now share no prefix and are named for what they
do.

**The old spellings are refused, not ignored.** `process.argv.includes('--no-charge')`
on a command that no longer knows that flag is silently `false` and the run
proceeds — charging every enrolled agency. So an old spelling prints what
replaced it and exits `2` having run nothing. `settlement-cli-flags.test.ts`
spawns the real command and asserts it, including the half-updated
`--dry-run --settle-without-charge`, which stops rather than guessing.

`--settle-without-charge` is the run-level form of `chargesEnabled: false` and is
one-directional: it can only turn charging off. There is no flag or body field
that turns charging **on** for an agency whose profile says otherwise, because a
per-run switch that starts charging somebody is a switch somebody passes by
accident once. The HTTP form is
`POST /api/v1/platform/delivery/settlement/run {"settleWithoutCharge": true}`.

---

## 0c. The closeout — what happens to the dry run's credits

A dry-run settlement **sells** the next Delivery Day's block, and nobody paid for
it. Left alone those credits carry into the first charging settlement and shrink
it: the block is the daily target minus unused paid applications (§4 step 4), and
the ledger cannot tell an unpaid dry-run credit from a bought one. The agency's
first real billing day would deliver a short block, on credits nobody paid for.

So at the moment charging is turned on — and only then — every remaining
dry-run credit is retired. The balance starts at zero and the first real
settlement sells a full block.

```
PUT /api/v1/platform/delivery/agencies/:tenantId/charges  {"enabled": true}

  → { chargesEnabled: true,
      dryRunCloseout: { lotsRetired: 1, creditsRetired: 45, balanceAfter: 0 } }
```

### It is not a reversal

`DRY_RUN_CLOSEOUT` is its own entry type precisely so it cannot be mistaken for
one. Nothing is returned to anybody and no money moves, because no money ever
moved: these credits were issued to make an observation possible and were never
sold. The rows carry a null `amount` and a null `stripePaymentIntentId`, and
that is asserted. It is not a refund, a credit, a reversal, a rebate or a
make-good — none of those exists here, which the enum test asserts.

### Append-only stays intact

Nothing is updated and nothing is deleted. The purchases stay exactly as they
were written; the retirement is a **later row**, which is the only correction
this ledger has. One row per retired lot, carrying:

| field | |
| --- | --- |
| `quantity` | negative — whatever was left on that lot |
| `deliveryDay` | the day the retired block was **for**, not when somebody pressed the button |
| `unitRate` | the rate the block was nominally sold at, so the row reads on its own |
| `amount` | **null** — no money moved in either direction |
| `purchaseEntryId` | the lot it retired |
| `settlementId` | the `DRY_RUN` settlement that sold that lot |
| `lotIndex` | `-1` |

### It cannot happen twice

`lotIndex = -1`. A real unit index is never negative, so `-1` is a slot no
consumption can occupy, and the existing unique index on
`(purchaseEntryId, lotIndex)` then guarantees a lot is retired **at most once** —
a database constraint, not a check-then-act. Turning charging on twice retires
nothing the second time; turning it on twice at once retires each lot once.
Asserted by two concurrent enables.

### What is not retired

Only lots sold by a settlement whose `paymentStatus` is `DRY_RUN`. An agency's
opening purchase was paid for by card or ACH and carries no settlement at all; a
block sold by a settlement that was charged was paid for. Neither is touched and
both keep their credits.

### During the dry run, the credits count

They are **not** excluded from the balance while the dry run is running. If they
were, every application would be Overrun from the first hour and delivery would
stop at the ceiling on day one — what was being watched would be a starved
agency rather than the real system. It is the transition that needs the entry,
not the dry run.

### Seeing the number before pressing the button

`GET /api/v1/platform/delivery/agencies/:tenantId/enrolment` reports the current
`balance` and `pendingDryRunCloseout: { lots, credits }` — what turning charging
on would retire, computed the same way as the closeout itself so the preview and
the act cannot disagree.


---

## 0d. Go-live runbook — one agency, unenrolled to charging

Read this as a checklist. Every step says what to do, how to confirm it worked,
and how to undo it. Work down the list; do not skip the verifications.

**The one thing to hold in your head:** three steps are irreversible, and they
are irreversible because this product has no refund path. They are step 4 and
step 9 (real debits) and step 8's closeout (an append-only ledger row). Every
other step can be walked back in one call.

**Before you start**, have to hand:

| | |
| --- | --- |
| tenant id | `SELECT id, name, slug FROM tenants WHERE slug = '…';` |
| a platform admin token | an agency OWNER token gets 403 on every step here |
| the Insertion Order | the agreed rate, the Daily Block, the maximum daily debit |
| the arithmetic | maximum daily debit = (block + ceiling) × rate. 45 agents at $134 with a 50% ceiling is (45 + 22) × 134 = **$8,978**. 15 agents is (15 + 7) × 134 = **$2,948**. |

Below, `$T` is the tenant id and `$ADMIN` a platform admin bearer token. Routes
are written relative to `https://<api>/api/v1`; in full, each call is:

```sh
curl -sS -X GET "$API/api/v1/platform/delivery/agencies/$T/enrolment" \
     -H "Authorization: Bearer $ADMIN" | jq .
```

---

### Step 0 — Confirm the agency is untouched today

```
GET /platform/delivery/agencies/$T/enrolment
```

**Expect** `enrolled: false`, and a `blockers` list naming everything not yet in
place. Nothing about this agency's delivery is gated while that is false — that
is the whole point of §0, and it is what makes the rest of this list safe to do
during business hours.

**Undo:** nothing has been done.

---

### Step 1 — Record the commercial terms

```
PUT /platform/delivery/agencies/$T/terms
{ "dailyBlockApplications": 45, "maxDailyDebit": 8978 }
```

`maxDailyDebit` is the figure on the Insertion Order, not a guideline: a
settlement above it **halts without charging** and alerts platform admins, and
is never clamped down to it (§4). Getting it wrong low means nightly halts;
getting it wrong high means the contractual cap is not enforced.

**Verify** — re-read the enrolment status; `NO_DAILY_BLOCK` and
`NO_MAX_DAILY_DEBIT` are gone from `blockers`:

```
GET /platform/delivery/agencies/$T/enrolment
```

**Undo:** `PUT` the same route with the previous values. The agency is not
enrolled yet, so nothing is gated on these and there is no delivery impact.

---

### Step 2 — Record the agreed opening rate

```
PUT /platform/rating/agencies/$T/opening
{ "openingRate": 134, "openingBlockApplications": 45, "note": "IO 2026-09-01" }
```

**Verify** — `NO_OPENING_RATE` is gone from `blockers`.

**Undo:** `PUT` again with the right figure. Note that rate history is an
immutable record: a corrected rate is a **new** row, and the wrong one stays
visible as something that was set and then changed. That is deliberate.

---

### Step 3 — The agency completes its ACH mandate

This one is not yours to do. The agency's own principal, signed in, in their
browser:

```
POST /delivery/mandate/setup-intent     → Stripe client secret
   … the agency verifies its bank account with Stripe …
POST /delivery/mandate/confirm          { "setupIntentId": "seti_…" }
```

Every fact recorded — the payment method, the bank, the last four, whether it is
usable at all — is read back **from Stripe by the server**. A browser saying
which account a five-figure daily debit comes out of is not believed (§5).

**Verify** — `NO_VALID_MANDATE` is gone from `blockers`, and `mandate` names the
account you expect. A mandate existing is not the same fact as a mandate on the
right bank account, and this is the last point at which noticing is cheap:

```
GET /platform/delivery/agencies/$T/enrolment
   → mandate: { status: "ACTIVE", valid: true, bankName: "…", last4: "6789" }
```

**Undo:** nothing to undo. An unused mandate charges nothing. If the wrong
account was attached, have them attach the right one — the server re-reads it.

---

### Step 4 — Sell the opening block ⚠️ real money

```
POST /platform/delivery/agencies/$T/opening-purchase
{ "quantity": 45, "unitRate": 134, "method": "CARD", "deliveryDay": "2026-09-14" }
```

`"CARD"` is permitted **here and nowhere else** — this is the opening purchase.
Daily settlement is ACH only; card fees at these volumes would run roughly
$87,000 a year on one account (§5). Omit `method` for ACH.

**Check the arithmetic before you send it.** 45 × $134 = $6,030. The maximum
daily debit governs *settlements*; it does not cap this call.

**Verify** — a `201` whose body carries `balance` equal to the quantity:

```
GET /platform/delivery/agencies/$T/enrolment      → balance: 45
```

**Undo: none.** This is a real charge and the product has no refund, credit,
reversal or make-good, by design. A repeat of the *identical* call does not
double-charge — Stripe is given an idempotency key of
`opening:$T:<day>:<quantity>:<rate>` — but a call with a different quantity or
rate is a second charge.

---

### Step 5 — Enrol ⚠️ first step with a delivery consequence

Check readiness first. Do not skip this: enrolment takes effect on the **next
call offered**, so enrolling an agency that is missing something reproduces the
original production-stopping defect one step later and with your name on it.

```
GET /platform/delivery/agencies/$T/enrolment      → readyToEnrol: true, blockers: []
POST /platform/delivery/agencies/$T/enrol         { "note": "IO 2026-09-01, go-live" }
```

**Verify** — within a minute or two of the next calls being offered:

```
GET /platform/delivery/overview?day=YYYY-MM-DD    the cross-agency view
```

The agency now appears with a balance and **no flags**. If it shows
`noValidMandate`, `ceilingReached`, `unpaidSettlement` or `paused`, delivery has
stopped — go to the symptom table at the end of this section.

```sql
-- Nothing should have been written here. A row means delivery was refused.
SELECT * FROM delivery_hold_events WHERE "tenantId" = '…' ORDER BY "createdAt" DESC LIMIT 5;
```

**Undo:**

```
POST /platform/delivery/agencies/$T/unenrol       { "reason": "backing out go-live" }
```

Immediate, and complete: the gate stops being consulted, applications stop being
metered and the nightly run stops looking at the agency. The ledger and any
settlements already written are **not** touched — they are the record of what
the agency was charged, and nothing here removes them.

---

### Step 6 — Watch three Delivery Days settle, with no money moving

Charging is a **second** switch and it is still off, so the nightly run records a
full settlement and places no debit (§0b). Nothing to turn on; this is what
being enrolled and not charging does.

Each morning, before reading the numbers, you can preview without writing:

```
pnpm --filter @hopwhistle/api settlement:run -- --plan-only --tenant $T --day 2026-09-15
```

Then the real (still money-free) run, if the cron has not already done it:

```
pnpm --filter @hopwhistle/api settlement:run -- --day 2026-09-15 --tenant $T
```

**Verify** each day:

```sql
SELECT "deliveryDay", "deliveredCalls", "submittedApplications", "rate",
       "overrunQuantity", "nextBlockQuantity", "totalCharged", "paymentStatus"
  FROM daily_settlements WHERE "tenantId" = '…' ORDER BY "deliveryDay";
```

- `paymentStatus` is `DRY_RUN` on every row. Anything else means charging is on.
- `totalCharged` is what you expect from the rate and the counts.
- `HALTED_MAX_DEBIT` on any day is a real finding, not a dry-run artefact: that
  day would have breached the Insertion Order cap. Understand it before step 8.
- No payment attempt rows exist:
  `SELECT count(*) FROM settlement_payment_attempts WHERE "settlementId" IN (…);`

**Undo:** `POST …/unenrol` as in step 5. Nothing has been charged.

---

### Step 7 — Invoice the dry run, by hand

Do this **before** step 8, while `mode=DRY_RUN` still means exactly "the days
nobody was charged for".

```
GET /platform/delivery/settlements.csv?tenantId=$T&from=2026-09-15&to=2026-09-17&mode=DRY_RUN
```

One row per Delivery Day, carrying everything an invoice is raised from (§0b).
The sum of `total_charged` is the amount to invoice; each row shows the counts,
the closing percentage, the rate and the curve version it came from, so a line
item can be explained without opening the application.

**Verify** — the number of rows equals the number of Delivery Days you watched.
A missing day means that day never settled; find out why before continuing.

**Undo:** nothing was changed.

---

### Step 8 — Turn charging on ⚠️ retires the dry run's credits, irreversibly

**Timing.** Do this *after* the last dry-run Delivery Day's settlement has run,
and *before* the next Delivery Day's calls start — early in the morning. Doing
it mid-day retires the credits the agency is delivering against right then, and
it will stop at its Overrun ceiling within the hour.

Read the numbers first:

```
GET /platform/delivery/agencies/$T/enrolment
   → balance: 45, pendingDryRunCloseout: { lots: 1, credits: 45 }
```

That is what is about to be retired: blocks the dry run sold and nobody paid
for. Confirm it looks like one or two blocks, not a surprise.

```
PUT /platform/delivery/agencies/$T/charges        { "enabled": true }
   → { chargesEnabled: true,
       dryRunCloseout: { lotsRetired: 1, creditsRetired: 45, balanceAfter: 0 } }
```

**Verify** — the closeout matches the preview and the balance is now zero:

```
GET /platform/delivery/agencies/$T/enrolment
   → balance: 0, pendingDryRunCloseout: { lots: 0, credits: 0 }
```

**Undo — read this carefully, it is two different things:**

| | |
| --- | --- |
| the charging switch | `PUT …/charges {"enabled": false}` — reversible, immediate, future settlements go back to `DRY_RUN` |
| the closeout | **not reversible.** It is an append-only ledger row, and there is no path in this system that returns a credit. |

So turning charging back off does **not** restore the retired credits. An agency
left on a zero balance delivers on Overrun only and stops at its ceiling. If you
back out here, you must also sell it a block — step 9 — or it will run short the
next day.

---

### Step 9 — Sell the first paid block for the cutover day ⚠️ real money

**This step is required, not optional.** After the closeout the balance is zero.
An agency on a zero balance is in Overrun from its first application and stops
delivering at its ceiling — 50% of the Daily Block, so 22 applications for a
45-agent agency — partway through the morning.

```
POST /platform/delivery/agencies/$T/opening-purchase
{ "quantity": 45, "unitRate": 134, "deliveryDay": "2026-09-18" }
```

ACH, not card (omit `method`). `unitRate` is the agency's current rate — read it
from the last settlement's `rate`, not from memory.

**Verify:**

```
GET /platform/delivery/agencies/$T/enrolment      → balance: 45
GET /platform/delivery/overview                   the agency shows a balance, no flags
```

**Undo: none.** A real debit against a real mandate, and there are no refunds.

> **Why not just let the last dry-run settlement charge?** Turning charging on
> *before* the final dry-run day's settlement would make that settlement charge
> the day's Overrun and sell a full paid block in one debit, and step 9 would be
> unnecessary. It is not the recommended order because that day then appears
> both on the hand-raised invoice from step 7 and on the agency's bank
> statement. One clean line between "invoiced by hand" and "charged
> automatically" is worth an extra debit.

---

### Step 10 — The first charged settlement

That night's run charges the cutover day's Overrun plus the next day's block as
**one** debit (§4).

```
pnpm --filter @hopwhistle/api settlement:run -- --day 2026-09-18 --tenant $T
```

**Verify:**

```sql
SELECT "deliveryDay", "totalCharged", "maxDailyDebit", "paymentStatus",
       "stripePaymentIntentId", "gracePeriodEndsOn"
  FROM daily_settlements
 WHERE "tenantId" = '…' ORDER BY "deliveryDay" DESC LIMIT 1;
```

| `paymentStatus` | what it means | what to do |
| --- | --- | --- |
| `SUCCEEDED` / `PENDING` | the debit was accepted by Stripe. ACH settles over days, so `PENDING` is normal for a while | nothing; `settlement:run -- --resume-stalled` picks up the ones Stripe has since resolved |
| `NOT_CHARGED` | nothing was owed that day | nothing |
| `HALTED_MAX_DEBIT` | the total breached the Insertion Order cap; **no debit was placed** and platform admins were notified | do not raise the cap to make it go through — find out why the day was that large |
| `HALTED_NO_MANDATE` | the mandate stopped being usable | back to step 3 |
| `FAILED` | the debit was declined. Delivery holds at the paid balance once the Business Day grace period expires | `settlement:run -- --retry-failed` after the agency fixes the account |

Run it once more, deliberately, and confirm it charges nothing: one settlement
per agency per Delivery Day is a unique index, so the second run reports
`alreadySettled` (§4).

**Undo:** `PUT …/charges {"enabled": false}` stops *future* settlements from
charging. It does not undo a debit that has already been placed.

---

### If something looks wrong

| symptom | first thing to look at | the stop |
| --- | --- | --- |
| the agency stopped delivering right after enrolling | `GET /platform/delivery/overview` for its flags; `delivery_hold_events` for the reason | `POST …/unenrol` |
| it stops mid-morning every day | balance is zero and it is hitting the Overrun ceiling — it needs a block, or its Daily Block is set too low | sell a block (step 9) |
| a settlement halted on the maximum daily debit | the day's counts and rate; the cap is a contractual commitment, so the day is the thing to explain, not the cap | leave it halted |
| a debit failed | `settlement_payment_attempts` for Stripe's failure code; the agency has until `gracePeriodEndsOn` (Business Days) before delivery holds | `--retry-failed` once fixed |
| you are not sure and calls are moving | — | `POST /platform/delivery/agencies/$T/suspend` stops delivery immediately and does **not** touch the ledger; paid applications survive it and are there when you resume |
| you want the agency out of billing entirely | — | `POST …/unenrol`. Ledger and settlements stay as the record of what was charged |

**Nothing on this page ever gives money back.** Suspend, unenrol and disabling
charging all stop things happening *next*; none of them reverses a debit, a
consumption or a closeout. That is the design, not a gap in the runbook.

---

## 1. The ledger

`application_credit_ledger`. Append-only, per tenant, and the only source of a
balance.

    balance = SUM(quantity) WHERE "tenantId" = $1

There is no counter column here or anywhere else. A counter is wrong the first
time a write is retried or a job is re-run, and this number decides whether a
call is delivered and whether an application is billed tonight.

### Four kinds of row

| Type | `quantity` | Carries |
| --- | ---: | --- |
| `PURCHASE` | +N | the unit rate, the amount, the Delivery Day the block is **for**, the Stripe payment reference, and the rate curve version that priced it |
| `CONSUMPTION` | −1 | the application, the purchase lot it drew on, which unit of that lot, and the rate that lot was bought at |
| `OVERRUN` | 0 | the application and the Delivery Day. No rate: an overrun is priced that evening, and the settlement row for its Delivery Day is where that money is recorded |
| `DRY_RUN_CLOSEOUT` | −N | the lot it retires, the `DRY_RUN` settlement that sold that lot, the day that block was for, and the rate it was nominally sold at. `amount` is **null** — no money moved (§0c) |

An overrun does not move a balance because there was no balance to move.

A closeout is the only row that reduces a balance without an application behind
it, and it happens exactly once per agency, at the moment it starts being
charged. It is not a refund and nothing is returned: it retires credits a dry
run issued and nobody ever paid for. See §0c.

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

### An unenrolled agency is not gated at all

The first check, before any other condition and before any billing state is
read. See §0 — this is the ordering the whole switch rests on.

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

### An unenrolled agency is skipped, not settled at zero

Checked before anything is computed. A row saying zero would assert the agency
was billed nothing for the day, and the truth is different and worth keeping
distinguishable: it is not in the billing system. A night of zero-value rows for
every unenrolled tenant would also bury the days that were genuinely settled.

The run still walks every active tenant and reports a skip for each unenrolled
one, rather than querying only the enrolled — so the result names every agency
and says what happened to it, which is what an operator watching a staged
rollout wants.

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
pnpm --filter @hopwhistle/api settlement:run -- --plan-only               # compute and PRINT; writes nothing
pnpm --filter @hopwhistle/api settlement:run -- --settle-without-charge  # compute and RECORD; charges nobody
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

`--plan-only` is a **separate read-only path**, not the real one with a flag
threaded through it. A preview that shares the write path with the real run is
one `if` away from charging somebody. The retired spellings `--dry-run` and
`--no-charge` exit `2` and run nothing; see §0b.

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

Both exports — the agency's own `GET /api/v1/delivery/settlements.csv` and the
cross-agency `GET /api/v1/platform/delivery/settlements.csv` (§0b) — share one
column list and one row builder, so an agency and a platform admin cannot be
looking at differently shaped versions of the same day. The platform one adds
`agency` and `tenant_id` in front and takes `from`, `to`, `mode` and `tenantId`.

Both guard cells beginning `=`, `+`, `-` or `@` so a spreadsheet does not
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

`20260911000000_add_billing_enrolment/migration.sql` adds the enrolment and
charging switches, the `DRY_RUN` payment status and the `DRY_RUN_CLOSEOUT`
ledger entry type, on the same terms: additive, idempotent, drops nothing. Both
`ALTER TYPE ... ADD VALUE` statements sit **outside** the transaction block,
because that statement is not permitted inside one before PostgreSQL 12 and on
12+ the new value cannot be used in the transaction that adds it. It **enrols nobody** — there is no `UPDATE` setting an enrolment
anywhere in the file. Verified the same way: applied twice as a no-op, applied
from scratch, and `prisma migrate diff` reports no difference.

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
| `__tests__/settlement.test.ts` | 55 | enrolment, the dry run, the ledger, the ceiling, the gate, the settlement, the portal, and the absence of refunds — against a real database |
| `__tests__/delivery-gating-paths.test.ts` | 11 | that every delivery path asks the gate when the agency is enrolled, **and does not when it is not** — driven through the real route handlers |
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

On enrolment specifically:

- **every pre-existing tenant is unenrolled and ungated after the migration** —
  the case this switch exists for, asserted against a database the migration has
  been applied to;
- an unenrolled agency's submitted application writes no ledger row;
- the settlement skips it with no row at all;
- enrolment is refused with every missing precondition named at once;
- an agency cannot enrol itself, un-enrol itself or turn on its own charging;
- charging cannot be enabled for an agency that is not enrolled;
- un-enrolling leaves the ledger and the settlements untouched;
- the portal tells an unenrolled agency that billing does not apply rather than
  showing it zeroes.

On the dry run: the full record is written and the gateway is never called; the
block is sold with no Stripe reference; ten dry-run days do not raise the
ceiling; a dry run over the maximum daily debit still halts; and
`--settle-without-charge` overrides an agency that has charging enabled.

On the closeout at cutover: the dry run's credits are spendable while it runs
and the gate lets delivery through; turning charging on retires them and the
balance reaches zero; the paid opening block and any block that was actually
charged for are untouched; two concurrent enables retire each lot exactly once
and a third retires nothing; the row names its lot, its settlement and the day,
carries a null `amount` and refuses `UPDATE` and `DELETE`; and the first charged
settlement afterwards sells a **full** block, billing exactly the maximum daily
debit when the day ran to the ceiling.

On the export: every column an invoice needs is present by name; the day range
is inclusive; `mode` separates the days that took money from the days that did
not, with `FAILED` and `HALTED_MAX_DEBIT` counted as charged; a malformed date
or unknown mode is a 400 rather than the whole table; an agency principal gets
403; and an agency named `=1+1` does not reach a finance team as a formula.

On the settlement command's flags: `--dry-run` and `--no-charge` exit `2` having
printed what replaced them and run nothing, `--plan-only` says it is writing
nothing, and `--settle-without-charge` announces itself before it settles.

Also asserted: the ledger refuses `UPDATE` and `DELETE`; a settlement's figures
refuse to change; oldest-lot-first across two rates; the Insertion Order figures
`$8,978` and `$2,948`; the Business Day grace period across Labor Day; that no
refund enum member exists; that a carrier declining after submission returns
nothing; and that an agency cannot reach any platform surface.

Full API suite at the time of writing: **765 passed**. Typecheck errors
unchanged at 80; web typecheck unchanged at 127; no new lint findings.
