# DIALER V2 — PREDICTIVE PACING SPEC

> Normative spec for `apps/dialer-v2/src/pacing/controller.ts`. The implementation and its
> tests follow this document; where they diverge, this document is wrong and must be
> corrected rather than the behaviour quietly changed.
>
> **Revision note.** §4.2, §4.4, and §4.6 were rewritten after measuring the first
> implementation against the simulator. The original design produced **12.8% abandonment
> against a 3% target**. The three defects and their fixes are recorded in §8 rather than
> silently corrected, because each is a mistake that is easy to make again.

## 1. Contract

```ts
decidePacing(inputs: PacingInputs, prev: PacingState) => PacingDecision
```

Pure. No I/O, no clock read, no randomness — `nowMs` is an input. Same inputs ⇒ same
decision, which is what makes replay, shadow mode, and the simulator meaningful.

Invoked at least once per second per campaign, and additionally on: agent state change,
answer, hangup, reservation expiry, and supervisor command.

Every decision is persisted with its full input vector and a machine-readable reason. "Why
did it dial 7?" must be answerable from the database alone.

## 2. Inputs

See `PacingInputs` in the implementation for the authoritative list. Grouped:

- **Agent capacity** — `agentsEligible`, `agentsAvailable`, `agentsReserved`, `agentsOnCall`,
  `agentsWrapUp`. The availability forecast is computed inside the controller (§4.3), not
  supplied, so there is one source of truth for it.
- **Calls in flight** — `callsDialing`, `callsLiveWaiting`, `callsBridged`.
- **Measured rates** — `liveAnswers`, `attempts`, `meanAnswerLatencyMs`, `p95AnswerLatencyMs`,
  `meanHandleTimeMs`, `meanWrapUpMs`, `abandonRate`, `abandonSampleSize`,
  `assignmentLatencyMsP95`.
- **Limits** — `maxLinesPerAgent` (default 4), `powerLinesPerAvailableAgent` (default 2),
  `campaignConcurrencyRemaining`, `tenantConcurrencyRemaining`, `gatewayCapacityRemaining`,
  `maxCps`, `callableLeads`.
- **Policy** — `configuredMode`, `targetOccupancy` (0.90), `abandonTarget` (0.03),
  `abandonWarn` (0.02), `minSampleSize` (50), `minAbandonSample` (50),
  `assignmentDeadlineMs` (2000).
- **Health** — `eventLagMs`/`maxEventLagMs`, `agentStateAgeMs`/`maxAgentStateAgeMs`,
  `redisHealthy`, `eslHealthy`, `emergencyStop`.

`abandonSampleSize` — the number of live answers the abandonment rate was computed from —
is not optional. §8.3 explains why omitting it broke the controller.

## 3. Output

`PacingDecision`: `originateCount`, `mode`, `reasons[]`, `bindingConstraint`, `pLive` (the
upper bound actually divided by), `pLiveMean` (posterior mean, reporting only),
`predictedCapacity`, `predictedLiveAnswers`, `confidence`, `pauseCampaign`,
`abandonWarning`, `horizonMs`.

`bindingConstraint` is the single constraint that set the number. It is what the supervisor
UI renders when an operator asks why a campaign is dialing the way it is.

## 4. Algorithm

### 4.1 Hard stops (evaluated first, short-circuit to 0)

In order: `emergencyStop` → `!redisHealthy` → `!eslHealthy` → agent state stale → event lag
→ abandonment at ceiling (**only when measurable**, §4.6) → no callable leads → no eligible
agents.

Each returns `originateCount: 0` with the corresponding reason. Abandonment at the ceiling
additionally sets `pauseCampaign`.

### 4.2 Live-answer probability — an UPPER bound, not the mean

```
mean  = (liveAnswers + α) / (attempts + α + β)        α = 2, β = 18
sd    = sqrt(mean × (1 − mean) / (attempts + α + β))
pLive = clamp(mean + 2·sd, 0.01, 1)
```

**The direction of this estimate is the single easiest thing to get backwards.** Demand is
`deficit / pLive`, so a _low_ estimate of the answer rate produces _more_ calls. Using the
posterior mean therefore over-dials exactly when the estimate is most uncertain.

The upper bound inverts that: wide uncertainty ⇒ high assumed answer rate ⇒ fewer calls,
tightening onto the observed rate as evidence accumulates. The posterior mean is still
computed and reported as `pLiveMean`, but nothing paces on it.

`pLive` is floored at 0.01 as a numerical guard. The floor is not the safety mechanism —
§4.5's `MAX_LINES_PER_AGENT` is.

### 4.3 Agent availability forecast

```
horizonMs = clamp(p95AnswerLatencyMs, 3s, 30s)
P(ends within H) = 1 − exp(−H / meanDurationMs)

predictedCapacity = agentsAvailable
                  + agentsOnCall × P(call ends within H)
                  + agentsWrapUp × P(wrap ends within H)
                  − agentsReserved
```

Exponential survival is chosen for transparency, not realism: one parameter, monotone in
the measured mean, and its error is directly observable as a forecast-error metric.
Replacing it with an empirical survival curve is a Phase 3 optimisation that must beat it in
replay before it ships.

### 4.4 Demand, with a Poisson variance buffer

```
inflightLive  = callsDialing × pLive + callsLiveWaiting
nominalTarget = predictedCapacity × targetOccupancy
targetLive    = max(0, nominalTarget − SAFETY_Z × sqrt(nominalTarget))    SAFETY_Z = 1.5
rawCount      = ceil(max(0, targetLive − inflightLive) / pLive)
```

Live answers arrive as a roughly Poisson process, so the number arriving in any short
interval has standard deviation ≈ √mean. **Aiming at the mean overshoots capacity about
half the time, and every overshoot is a call abandoned on a real person.** The buffer holds
back 1.5 standard deviations.

The buffer is proportionally larger for small floors — √4/4 = 50% of a 4-agent target
versus √100/100 = 10% of a 100-agent one. That is the same statistical fact that makes
predictive dialing inappropriate below the agent threshold in §4.7, expressed as a
continuous penalty rather than a cliff.

`SAFETY_Z = 1.5` is tuned against the simulator (§7). It is the single most load-bearing
constant in the controller.

**Progressive/preview**: `rawCount = agentsAvailable − callsDialing`. §4.4 is bypassed
entirely, so progressive can never intentionally create more live answers than available
agents — asserted directly in the test suite.

**Power**: `rawCount = agentsAvailable × powerLinesPerAvailableAgent − callsDialing`.

### 4.5 Constraints (smallest wins; recorded as `bindingConstraint`)

| Constraint             | Bound                                              |
| ---------------------- | -------------------------------------------------- |
| `MAX_LINES_PER_AGENT`  | `maxLinesPerAgent × agentsEligible − callsDialing` |
| `CAMPAIGN_CONCURRENCY` | `campaignConcurrencyRemaining`                     |
| `TENANT_CONCURRENCY`   | `tenantConcurrencyRemaining`                       |
| `GATEWAY_CAPACITY`     | `gatewayCapacityRemaining`                         |
| `MAX_CPS`              | `floor(maxCps × tickSeconds)`                      |
| `LEAD_INVENTORY`       | `callableLeads`                                    |
| `RAMP_LIMIT`           | `floor(prev.originateCount × 1.5 + 1)`             |

`MAX_LINES_PER_AGENT` is the backstop that makes a `pLive` estimation error survivable: even
with `pLive` at its floor, the dialer cannot exceed 4 lines per logged-in agent.

`RAMP_LIMIT` is the anti-oscillation control. Growth is geometric-with-offset so a campaign
can ramp from zero (0 → 1 → 2 → 4 → 7 → 11 → 17 …) while a spike is impossible. Reduction is
deliberately **not** rate-limited: pacing may fall to zero in a single tick.

### 4.6 Abandonment braking

```
if abandonSampleSize < minAbandonSample:  no braking, no pause, no warning
else if abandonRate >= abandonTarget:     0, and PAUSE_CAMPAIGN
else:                                     multiply by 1 − (abandonRate / abandonTarget)²
```

Two properties matter here, and the first implementation got both wrong (§8.2, §8.3).

**Braking is continuous from zero**, not a taper that begins at the warning threshold.
Quadratic, so a campaign at a small fraction of the ceiling is barely penalised while one
approaching it decelerates hard.

**Nothing happens below the minimum sample.** A 3% rate cannot be represented by fewer than
34 observations; acting on a ratio derived from 8 live answers means one abandoned call
reads as a 12% breach. Early safety comes instead from progressive-mode start, the ramp
limit, and the lines-per-agent ceiling, all active from the first tick.

`abandonWarn` (2%) drives the supervisor alert and the compliance record. It no longer
drives the braking curve.

### 4.7 Confidence and mode degradation

```
attempts ≥ minSampleSize     && agentsEligible ≥ 8  → HIGH   → PREDICTIVE
attempts ≥ minSampleSize / 2 && agentsEligible ≥ 4  → MEDIUM → POWER
otherwise                                            → LOW    → PROGRESSIVE
```

Both clauses are conjunctions. An earlier draft used `||` on the MEDIUM row, which would let
a campaign with five agents and zero history run POWER.

Configured mode is a **ceiling, never a floor**: a campaign configured PREDICTIVE may run
PROGRESSIVE, but a campaign configured PROGRESSIVE never runs PREDICTIVE. Modes outside the
ladder (AI_VOICE, INBOUND, AGENTLESS …) are passed through unchanged.

The 8-agent floor for predictive is the mandate's §21 requirement. Below it, one unexpected
long call is a large fraction of capacity, and the cost of being wrong lands on a person who
answers to silence.

## 5. Degradation triggers (mandate §5.4 mapping)

| Trigger                   | Result                                         |
| ------------------------- | ---------------------------------------------- |
| too few agents            | POWER or PROGRESSIVE (§4.7)                    |
| unstable answer rate      | wider posterior ⇒ higher `pLive` ⇒ fewer calls |
| rising abandonment        | quadratic braking, then 0 (§4.6)               |
| stale heartbeats          | 0 (§4.1)                                       |
| FS event lag              | 0 (§4.1)                                       |
| Redis failure             | 0 (§4.1)                                       |
| unknown active-call count | caller passes `redisHealthy:false` ⇒ 0         |
| carrier failures          | `gatewayCapacityRemaining` → 0                 |
| no valid caller ID        | campaign pause, upstream of the controller     |
| high assignment latency   | linear damping to 0 at 2× the deadline         |
| queue overload            | `callsLiveWaiting` inflates `inflightLive`     |

Every degradation carries a `PacingReason` and is rendered verbatim in the supervisor UI.

## 6. Shadow mode

With `TENANT_DIALER_V2_SHADOW_ENABLED` and origination off, the controller runs against
**real** production agent and call state and persists every decision without originating.
Shipping gate for Phase 3: ≥ 14 days of shadow with agent-availability forecast error within
tolerance and zero would-have-exceeded-abandonment intervals.

## 7. Measured behaviour

From `simulator.test.ts`, 1,800 simulated seconds, 18% ground-truth live-answer rate, 150 s
mean handle time. These are simulator figures, not production figures.

| Scenario                         | Abandonment | Occupancy | Bridged |
| -------------------------------- | ----------- | --------- | ------- |
| Predictive, 20 agents            | 0.50%       | 85.0%     | 201     |
| Predictive, 12 agents            | 0.00%       | 77.6%     | 113     |
| Predictive, 20 agents (seed 7)   | 1.55%       | 84.2%     | 191     |
| Progressive, 20 agents (seed 7)  | 0.00%       | 71.3%     | 158     |
| Answer rate 0.10 → 0.45 at t=900 | 6.11%       | 74.4%     | 169     |
| 20 agents → 5 mid-run            | 0.00%       | 81.2%     | 92      |

Predictive delivers ~21% more conversations and ~13 points more occupancy than progressive
on the same seed, while staying inside the 3% ceiling.

**Known limitation, not yet solved.** An instantaneous 4.5× jump in the answer rate produces
a transient that reaches ~6% abandonment before the controller settles. The rolling window
cannot detect a step change faster than it can accumulate a sample. Candidate fixes for
Phase 3 — change-point detection on the answer rate, or a shorter parallel estimator — must
demonstrate improvement in replay before shipping. Until then, predictive campaigns on lists
of unknown or mixed provenance should start in POWER.

## 8. Defects found by the simulator

Recorded because each is easy to reintroduce.

**8.1 — Inverted estimator.** The first version divided by the Beta posterior _mean_, and a
deliberately pessimistic 0.10 prior was described in this document as making the controller
"pace conservatively". It does the opposite: demand is `deficit / pLive`, so a pessimistic
answer-rate estimate is an _aggressive_ pacing decision. Fixed by dividing by the upper
credible bound (§4.2).

**8.2 — Aiming at the mean.** Targeting `capacity × occupancy` with no variance allowance
overshoots roughly half the time, because Poisson arrivals cluster. Fixed by the √-scaled
buffer (§4.4). This one change moved abandonment from 12.8% to 0.5%.

**8.3 — Rate without a denominator.** Braking only between 2% and 3%, on a ratio computed
from any sample size, produced a bang-bang loop: dial, breach, hard-stop, drain the window,
dial, breach. The campaign was hard-stopped for **1,341 of 1,800 ticks**. Fixed by
continuous braking from zero plus a minimum sample size (§4.6).

None of these were visible from reading the code. All three were found by running the
simulator and asking why the numbers were wrong, which is the argument for building the
harness before trusting the controller with a telephone line.

## 9. Explicitly rejected approaches

- **Static lines-per-agent.** Ignores answer rate. Note that a mis-tuned controller
  _degenerates_ into this — when `MAX_LINES_PER_AGENT` is the binding constraint on most
  ticks, the adaptive logic has stopped contributing. `bindingConstraint` makes that visible.
- **ML pacing at this stage.** Every number here is traceable to a measured input. An ML
  model may replace §4.2/§4.3 only after beating them in replay and shadow.
- **Optimistic priors.** A new campaign must under-dial. Abandonment errors are asymmetric:
  idle agents cost money; abandoned calls cost regulatory exposure and reach real people.
