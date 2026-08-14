# Phase 5 (rewritten) — Adaptive Route Scoring

**Supersedes Phase 5 in `sbc-multiroute-build-spec.md` entirely.** Delete that
section and use this. Phases 0–4 and 6 are unchanged.

Two things forced the rewrite: the production measurements from the Phase 0 recon
turned up confounders the original design would have silently absorbed, and the
`hoppwhistle` repo already contains a better version of the machinery the
original Phase 5 asked you to build from scratch.

---

## 1. Do not build this from scratch

`apps/dialer-v2/src/pacing/controller.ts` in `bbarnes4318/hoppwhistle` is the
pattern. Read it before designing anything. What it gets right and what you will
copy:

- **Pure function.** `nowMs` is an input. No I/O, no `Date.now()`, no randomness.
  The header comment states the reason plainly: it makes replay, shadow-mode
  comparison and deterministic simulation possible, and it means the
  highest-risk logic is testable without FreeSWITCH, Redis or a database. The
  same applies here — a pure route scorer is testable on the Windows dev
  checkout with no Asterisk, no lab box and no carrier.
- **Transparent statistics.** Beta-Binomial smoothing, exponential survival.
  Every number traceable to a measured input.
- **Every decision carries the constraint that bound it.** `PacingReason` +
  `PACING_REASON_TEXT`. Do the same with a `RouteReason` enum.
- **Confidence is a first-class output.** `Confidence = 'LOW' | 'MEDIUM' | 'HIGH'`.
- **Shadow mode before live.** `src/shadow/engine.ts`, `ShadowEngine`,
  `ShadowDecisionRecord`, `CONTROLLER_VERSION`, `explainDecision()`.
- **A deterministic simulator.** `src/sim/`.

Reuse specifically: `liveAnswerProbability()` and
`pacingLiveAnswerProbability()` (controller.ts:227, :247) as the model for the
scorer's estimators, `PRIOR_ALPHA` / `PRIOR_BETA` as the convention, `SAFETY_Z`
as the lower-bound convention, and the whole `ShadowEngine` harness.

### Where the code lives

New package `packages/route-scoring` in the **hoppwhistle monorepo**, not the
`voip` repo. Rationale:

- The Beta-Binomial estimators, the shadow harness and the simulator are all
  there. Reimplementing them in Python in the `voip` repo means two
  implementations of the same statistics, which will drift.
- Pure TypeScript with injected time tests fine on the Windows dev checkout.

**The call paths stay strictly separate.** The `voip` README is explicit that
isolation from `hoppwhistle` is the point — separate box, separate subaccount,
separate IP, keeping wholesale traceback exposure off the address carrying your
own campaigns. That reasoning stands and nothing here changes it. The seam is a
**file**: the scorer emits `routes.csv`, `routectl.sh` in the `voip` repo loads
it into astdb. No network path, no shared database, no shared process. Data-level
integration only.

---

## 2. What the production data changed

The Phase 0 recon measured things the original Phase 5 assumed away. Each of
these is a confounder that would have made the scorer confidently wrong.

### 2.1 Historical CDR is not comparable to post-Phase-0 CDR

Amplification was 2.48x on 08-11 and 1.67x on 08-12, tracking ring depth as the
gateway count fell 7 → 6 → 5. After Phase 0 ships, `MAX_ROUTE_ATTEMPTS=2` and the
`CHANUNAVAIL` split change the attempt population fundamentally.

**The scoring window starts at the Phase 0 deploy timestamp.** Make it an
explicit config value, not a rolling "last 7 days" that silently reaches back
across the change. Refuse to score at all until the window holds enough
post-deploy data, and report that refusal as a `RouteReason`, not as a silent
fallback.

### 2.2 Topology epochs

The gateway set changed three times inside the current CDR window and it was not
flagged anywhere. A route's identity is not stable across a change to its
underlying proxy set.

Record a **topology epoch** — a hash of the active route and proxy configuration
— on every CDR row. The scorer treats observations from a different epoch as a
weaker prior for the current epoch rather than as equivalent evidence, and never
pools them silently. When the epoch changes, confidence drops to `LOW` and the
system leans on the hierarchical prior (§3.2) until data accumulates.

### 2.3 `NO_DID_AVAILABLE` must be excluded from route denominators

36,683 refusals over 08-10 to 08-14, 14,891 on 08-12 alone against 101,048 CDR
rows. **These calls never reached a route.** If they land in the denominator,
every route's ASR is understated by roughly 15% and the understatement is not
uniform — it concentrates in whichever NPAs exhausted their pool first, which is
exactly the dimension the scorer keys on.

Every CDR row with a `reject_reason` set is excluded from route scoring
entirely. Only rows that reached a `Dial()` count. Assert this in a test with a
fixture that includes rejected rows and confirms they do not move the estimate.

### 2.4 `did_selection_reason` is a confounder, and it is the important one

The dialplan already records `did_selection_reason` as `npa_match` or `overflow`.
An overflow DID is not local-presence for the destination. Its answer rate will
differ materially, and overflow usage spikes exactly when a pool is exhausted —
which correlates with high-volume NPAs, which is where most of your scoring data
comes from.

**Score `(route × NPA × did_selection_reason)` as separate strata.** Do not pool
them. A route that looks bad may simply have been dialed with overflow DIDs
during a pool exhaustion window.

This is also the first half of the joint DID × route model. Get the stratum right
now and Phase 7 becomes an extension rather than a rewrite.

### 2.5 Retry position is a confounder

After Phase 0, a call that fails on route A and is retried on route B gives route
B an outcome drawn from a systematically harder population — every one of those
calls already failed once.

Record the attempt index. **Score first-attempt outcomes as the production
signal.** Track second-attempt outcomes separately and report them, because
"how often does the retry rescue the call" is a genuinely useful number, but never
pool the two. Pooling makes fallback routes look worse than they are and the
scorer will demote them until they are never tried, which is self-fulfilling.

### 2.6 ACD is currently unusable as a quality signal

Calls cap at 44–47 seconds across 8,000+ answered calls and the cause is still
open with the carrier. Until that is resolved, ACD carries an artifact, not
information. Compute and report it; do not let it enter the score. Add a config
flag to turn it on once the ceiling is explained.

---

## 3. The scorer

### 3.1 Shape

```ts
export interface RouteScoringInputs {
  nowMs: number;
  windowStartMs: number;        // Phase 0 deploy time, not "7 days ago"
  currentEpoch: string;         // topology hash
  observations: RouteObservation[];
  routes: RouteConfig[];        // name, carrier, deck, per-prefix rate
  maxBlend: number;             // 0.0025
  trafficWeights: Map<string, number>;  // recent volume per prefix
  rng: () => number;            // injected, seeded — see §3.3
}

export interface RouteDecision {
  table: Map<string, string[]>; // prefix -> ordered route names
  projectedBlend: number;
  projectedAsr: number;
  confidence: Confidence;
  reason: RouteReason;          // what bound this decision
  diff: RouteTableDiff;         // vs the currently loaded table
}
```

Pure. `nowMs` and `rng` injected. Same contract as the pacing controller.

`RouteReason` mirrors `PacingReason`, with matching `ROUTE_REASON_TEXT`. At
minimum: `INSUFFICIENT_POST_DEPLOY_DATA`, `EPOCH_CHANGED`, `BLEND_CEILING_BINDING`,
`NO_ELIGIBLE_ROUTE`, `ALL_ROUTES_EQUIVALENT`, `EXPLORATION_DRIVEN`,
`HELD_AT_PREVIOUS_TABLE`.

### 3.2 Hierarchical priors replace the sample floor

The original spec said "minimum 200 attempts before a score is trusted." That is
a crude threshold and it throws away real information below the line while
treating 201 observations as certainty.

Use a three-level hierarchy instead. Each level is the prior for the one below:

```
fleet ASR  →  route ASR  →  (route × NPA)  →  (route × NPA × did_reason)
```

A cell with no data inherits its parent's posterior. A cell with a little data
shifts a little. A cell with a lot of data dominates its prior. The prior washes
out exactly as it does in `liveAnswerProbability()`, and there is no threshold to
tune. This is strictly better than the original design and it is the single most
important change in this rewrite.

Do not hardcode `PRIOR_ALPHA = 2, PRIOR_BETA = 18` — that prior encodes a 10%
live-answer rate, which is right for pacing and wrong for route ASR. Derive each
level's prior from the level above it, and make the top-level prior weight
configurable.

### 3.3 Thompson sampling replaces epsilon-greedy

The original spec specified a 5% random exploration slice. Replace it.

Sample each candidate route's ASR from its Beta posterior and rank by the sample.
A route with wide uncertainty is sometimes drawn high and gets tried; a route with
tight low posterior is almost never drawn high. Exploration becomes proportional
to uncertainty and self-extinguishing, with no epsilon to tune, and it reuses the
Beta machinery already in the estimator.

Keep the exploration tagging in CDR — you still want to identify
exploration-driven picks after the fact — and keep `EXPLORE_PERCENT` as an
emergency cap on total exploration share, defaulting off.

The RNG is injected and seeded so the whole thing stays deterministic and
replayable. Same reason the pacing controller takes `nowMs`.

### 3.4 Ranking and the budget

Rank candidate routes per prefix by **sampled ASR** (§3.3), not by rate.

Then enforce the blend. Compute projected blended rate weighted by each prefix's
recent volume. If it exceeds `maxBlend`, demote prefixes in ascending order of
ASR-loss-per-dollar-saved until the projection is under the ceiling. Fractional
knapsack; greedy on Δasr/Δcost is optimal.

**Do the budget check against the lower confidence bound of ASR, not the sampled
value.** Selection wants optimism under uncertainty; committing money wants
pessimism. This is the same asymmetry `pacingLiveAnswerProbability()` documents
at controller.ts:236 — it uses a lower bound rather than the posterior mean
because using the mean over-dials whenever the estimate is uncertain. Here, using
the mean over-commits budget.

**Do not solve the budget with a flat per-prefix rate cap.** That discards exactly
the expensive-but-connecting routes this project exists to use.

Remember the headroom: 40% ShortDuration / 35% CVPreferred / 25% MASH blends to
$0.002096, and up to 67% MASH on an SD base stays under $0.0025. The ceiling is
unlikely to bind often. If `BLEND_CEILING_BINDING` shows up on most runs,
something is wrong with the rate inputs — investigate rather than accepting it.

### 3.5 Hold-down

A table that churns every night is worse than one that moves deliberately. If the
new table's projected ASR does not beat the current table's by a configurable
margin, emit `HELD_AT_PREVIOUS_TABLE` and change nothing. Report the diff either
way.

---

## 4. Rollout

### 4.1 Shadow first, and for longer than feels necessary

Run the scorer nightly producing a table it does not apply. Log what it would
have chosen. Use the `ShadowEngine` pattern from `apps/dialer-v2/src/shadow/`
including `CONTROLLER_VERSION` on every record, so decisions stay attributable to
a scorer version after the fact.

Minimum two weeks of shadow before live, and do not go live until the shadow
table has been stable across at least one topology epoch change. The scorer's
whole failure mode is confident nonsense from a confounded estimate, and shadow
mode is the only place that surfaces cheaply.

### 4.2 Deployment

Scorer emits `routes.csv`. `routectl.sh` loads it into astdb. **No `dialplan
reload`** — that is the entire point of the Phase 3 astdb revision, and it removes
the riskiest step from the nightly job.

The job must: refuse to load a table failing validation; keep the previous
`routes.csv` with one-command rollback; refuse a table whose projected blend
exceeds the ceiling; log the diff. `--dry-run` prints the diff and changes
nothing. **Default to dry-run** until explicitly enabled.

### 4.3 Simulator

Extend the `apps/dialer-v2/src/sim/` harness to generate synthetic route
observations with known ground-truth ASR per (route × NPA × did_reason), then
assert the scorer converges on the right ordering. Include: a route that is good
everywhere, a route good only in specific NPAs, a route whose ASR changes
mid-window, a cell with zero observations, a cell polluted with rejected rows,
and an epoch change mid-window.

This is testable on the dev checkout with no infrastructure. **It is the primary
verification for Phase 5** — there is no `VERIFY:` item here needing the lab.

---

## 5. Reporting

Extend `monitor.sh` with per-route ASR and ACD, and **cost per connected minute**
(`rate ÷ ASR`) per route. That last one is the metric the operator actually needs:
a route at $0.0029 with 55% ASR beats one at $0.0017 with 30%, and nothing in the
current tooling shows it.

Add a scorer report per run: table diff, projected blend, projected ASR,
confidence, binding reason, and the top ten prefixes by ASR gain. It should be
readable without opening the code — `explainDecision()` in the shadow engine is
the model.

---

## 6. Done when

- The pure scorer passes simulator tests for every scenario in §4.3
- Rejected rows, overflow-DID strata, retry-position and epoch changes each have a
  test proving they do not contaminate the estimate
- Two weeks of shadow output exist and have been reviewed
- `routectl.sh --dry-run` produces a readable diff against the live table
- No `dialplan reload` appears anywhere in the deployment path
