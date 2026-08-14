# `@hopwhistle/route-scoring`

Adaptive route scoring — Phase 5. Normative spec: [`phase-5-route-scoring-spec.md`](../../phase-5-route-scoring-spec.md).

Pure TypeScript. **No I/O of any kind**: no network, no filesystem, no database,
no `Date.now()`, no `Math.random()`. `nowMs` and `rng` are inputs. It runs and
tests on a Windows dev checkout with no Asterisk, no Redis and no carrier.

```bash
pnpm --filter @hopwhistle/route-scoring test
```

## What is here

|                        |                                                                           |
| ---------------------- | ------------------------------------------------------------------------- |
| `src/types.ts`         | The CDR row contract and the decision shape                               |
| `src/estimator.ts`     | Hierarchical Beta-Binomial estimation, credible bounds, Thompson sampling |
| `src/scorer.ts`        | `scoreRoutes()` — the pure scorer (§3)                                    |
| `src/sim/simulator.ts` | `runRouteSimulation()` — the deterministic simulator (§4.3)               |

Deployment (§4.2) is **not** built. The scorer produces a `RouteDecision`; the
step that renders it to `routes.csv` for `routectl.sh` to load into astdb comes
later, and there is no real data to score yet.

## The seam to the `voip` repo is a file, not a call path

The scorer lives in this monorepo because the Beta-Binomial estimators, the
shadow harness and the simulator are all here, and a second implementation in
Python would drift. Isolation of the SBC from this monorepo is the point of the
split and nothing here changes it: no network path, no shared database, no
shared process. Data-level integration only.

## The one thing to read before changing anything

Both places this package leaves the posterior mean, it moves **up**. That looks
like one of them must be a copy-paste error. Neither is:

- **Ranking** draws from the posterior (Thompson, §3.3). Optimism under
  uncertainty is what produces exploration, and it self-extinguishes as the
  posterior narrows. A lower bound here would rank an untried route last forever
  on the strength of having no data.
- **The blend check** uses an upper bound (§3.4). The blend is minute-weighted
  and billed minutes scale with ASR, so ASR sets each route's _share_ of the
  blended rate. Understating an expensive route's ASR understates the minutes it
  carries, the projection reads cheaper than production, and the ceiling gets
  breached by a table that validated as affordable.

"Committing money wants pessimism" is correct as a principle and points at the
wrong bound: the pessimism belongs on the cost projection, and pessimism about
cost _is_ optimism about ASR. See the note on `SAFETY_Z` in `estimator.ts`. The
test `weights the projection by the UPPER bound of ASR` exists to fail if someone
"fixes" this.

## The five confounders

Each has its own scenario proving contamination does not occur. Four are from
§2; the fifth is not in the spec as written.

| Confounder           | Rule                                                             | Scenario                                               |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| §2.1 pre-deploy rows | Excluded by `windowStartMs`                                      | `excludes rows stamped before the window opened`       |
| §2.2 topology epoch  | Down-weighted prior, never pooled; confidence drops to LOW       | `an epoch change drops confidence rather than pooling` |
| §2.3 rejected rows   | Any non-empty `reject_reason` excludes the row entirely          | `rejected rows never move an estimate`                 |
| §2.4 DID selection   | `npa_match` and `overflow` scored, ranked and emitted separately | `overflow and npa_match strata are never pooled`       |
| §2.5 retry position  | Only `attempt_index === 1` feeds the estimate                    | `first-attempt and retry outcomes are never pooled`    |
| **prior weight**     | Each level's prior weight is capped by the parent's own evidence | `a thinly observed parent lends thin confidence`       |

If you find yourself wanting to pool any of these "just for the low-sample
case", that is the bug this design exists to prevent. The low-sample case is
handled by the hierarchy in §3.2 —
`fleet → route → (route × NPA) → (route × NPA × did_reason)` — which is what
replaced the original spec's 200-attempt threshold.

## The table is keyed on (stratum, prefix)

Not on prefix alone. The dialplan knows which stratum it is in _before_ it picks
a route — `SBC_DID_REASON` is assigned at `extensions.conf.tpl:402/:409`, the DID
pick Gosub runs at `:403/:410`, and the dial loop does not begin until `n(dial)`
at `:451`, where the variable is still live (`:458`). So the table loads as
`sbc/route/npa_match/<digits>` and `sbc/route/overflow/<digits>` and still costs
three `DB()` reads.

It is necessary, not merely possible: production ran **60.6% overflow**. Ranking
on `npa_match` alone would rank the table on a minority of live traffic, and the
strata genuinely disagree — the §2.4 fixture has one route at 60% local-presence
and 5% overflow, and the test asserts the two strata emit _different_ leads,
which no pooled model can produce. `trafficWeights` is keyed the same way, so the
minute-weighted blend prices overflow traffic at overflow ASR.

An overflow cell with no observations of its own follows the `npa_match`
ordering rather than being ranked off a Thompson draw from its parent prior, and
says so via `OVERFLOW_FALLBACK_TO_NPA_MATCH`.

## Two mechanisms guard staleness, and they are not the same mechanism

- **The window start (§2.1) is a cliff.** Pre-Phase-0 attempts came from a
  different process — amplification 2.48x on 08-11 against 1.67x on 08-12 as the
  gateway count fell — and are excluded at _any_ weight. Their bias is
  systematic, not noisy, so a small weight is worse than zero.
- **Decay is the slope inside it.** Observation weight halves every
  `policy.halfLifeMs`, default 7 days. Without it the window only grows, so the
  time to correct a degraded route grows with it: after 90 days of history a bad
  week is 7% of the evidence and moves nothing.

`RouteDecision` reports both `scoredRows` (raw) and `effectiveScoredRows`
(decayed); the gap is how current the evidence is.

## Deliberate deviations from the spec

- **§3.4 said lower bound for the blend check.** It is an upper bound. See above.
- **§3.4 described `pacingLiveAnswerProbability()` as using a lower bound.** It
  returns `mean + 2·sd`, an upper bound (`controller.ts:247`).
- **`RouteObservation.observedAtMs` is not in the Phase 1 column list.** Added
  deliberately: `windowStartMs` is meaningless without a per-row timestamp.
  Phase 1 must emit it.
- **`RouteScoringInputs` carries `currentTable` and `policy`**, which §3.1 omits.
  The diff and the hold-down are both impossible without the former, and the
  latter keeps every threshold out of the code as a literal.

## Known limitations

- **Correction speed is bounded by the half-life and the parent prior.** The
  decay scenario measures this: at two half-lives roughly 81% of the decayed
  weight is post-change, so a route must fall meaningfully below its competitor
  to be demoted in that time. A route that degrades only slightly will take
  longer. `halfLifeMs` is the dial.
- **ACD is computed and reported but never scored** (§2.6), and the blend
  assumes ACD is equal across routes so it cancels out of the minute weighting.
  That holds only while calls cap at 44-47s across every route. Revisit when
  `useAcdInScore` is turned on.
