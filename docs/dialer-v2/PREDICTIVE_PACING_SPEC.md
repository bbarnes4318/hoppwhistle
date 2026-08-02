# DIALER V2 — PREDICTIVE PACING SPEC

> This is the normative spec for `apps/dialer-v2/src/pacing/`. The implementation and its
> tests follow this document; where they diverge, this document is wrong and must be
> corrected rather than the behavior quietly changed.

## 1. Contract

```ts
decidePacing(inputs: PacingInputs, prev: PacingState) => PacingDecision
```

Pure. No I/O, no clock read, no randomness — `nowMs` is an input. Same inputs ⇒ same
decision, which is what makes replay and simulation meaningful.

Invoked at least once per second per campaign, and additionally on: agent state change,
answer, hangup, reservation expiry, and supervisor command.

Every decision is persisted with its full input vector and a machine-readable reason. "Why
did it dial 7?" must be answerable from the database alone.

## 2. Inputs

```ts
interface PacingInputs {
  nowMs: number;
  tickSeconds: number; // pacing interval, default 1

  // Agent capacity
  agentsEligible: number; // logged in, on this campaign, fresh heartbeat
  agentsAvailable: number; // AVAILABLE and unreserved
  agentsReserved: number;
  agentsOnCall: number;
  agentsWrapUp: number;
  expectedFreeWithinHorizon: number; // forecast, §4.3

  // Calls in flight
  callsDialing: number; // originated, not yet answered
  callsLiveWaiting: number; // live human answered, not yet bridged
  callsBridged: number;

  // Measured rates
  liveAnswers: number; // successes in rolling window
  attempts: number; // trials in rolling window
  meanAnswerLatencyMs: number;
  p95AnswerLatencyMs: number;
  meanHandleTimeMs: number;
  meanWrapUpMs: number;
  abandonRate: number; // rolling, campaign-scoped
  assignmentLatencyMsP95: number;

  // Limits
  maxLinesPerAgent: number; // absolute safety ceiling, default 4
  campaignConcurrencyRemaining: number;
  tenantConcurrencyRemaining: number;
  gatewayCapacityRemaining: number;
  maxCps: number;
  callableLeads: number;

  // Policy
  targetOccupancy: number; // default 0.90
  abandonTarget: number; // default 0.03  (hard)
  abandonWarn: number; // default 0.02  (internal, stricter)
  minSampleSize: number; // default 50
  horizonMs: number; // default = p95 answer latency, clamped [3s, 30s]

  // Health
  eventLagMs: number;
  agentStateAgeMs: number;
  redisHealthy: boolean;
  eslHealthy: boolean;
  emergencyStop: boolean;
}
```

## 3. Output

```ts
interface PacingDecision {
  originateCount: number; // calls to place this tick
  mode: DialingMode; // possibly degraded from configured
  reasons: PacingReason[]; // every constraint that bound the result
  bindingConstraint: PacingReason; // the one that actually set the number
  pLive: number; // smoothed live-answer probability used
  predictedLiveAnswers: number;
  predictedCapacity: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  decisionId: string; // caller-supplied, for persistence
}
```

## 4. Algorithm

### 4.1 Hard stops (evaluated first, short-circuit to 0)

In order: `emergencyStop` → `!redisHealthy` → `!eslHealthy` → `agentStateAgeMs > staleAgentThreshold`
→ `eventLagMs > eventLagThreshold` → `abandonRate >= abandonTarget` → `callableLeads === 0`
→ `agentsEligible === 0`.

Each returns `originateCount: 0` with the corresponding reason. `abandonRate >= abandonTarget`
additionally signals `PAUSE_CAMPAIGN` to the caller.

### 4.2 Live-answer probability (Beta-Binomial)

```
pLive = (liveAnswers + α) / (attempts + α + β)     α = 2, β = 18
```

Prior mean 0.10 with weight 20 — a deliberately pessimistic start, so a campaign with no
history paces conservatively rather than optimistically. As `attempts` grows the prior
washes out.

`pLive` is floored at `0.01`. Without a floor, `N = deficit / pLive` diverges as `pLive → 0`.
The floor is a numerical guard, not the safety mechanism — the hard caps in §4.5 are.

### 4.3 Agent availability forecast

```
expectedFreeWithinHorizon = agentsOnCall   * P(call ends within H)
                          + agentsWrapUp   * P(wrap ends within H)
```

Using exponential survival with the measured means:

```
P(ends within H) = 1 - exp(-H / meanHandleTimeMs)
```

Exponential is chosen for transparency, not realism — it has one parameter, it is
monotone in the measured mean, and its error is observable as `agentForecastError` in
§19 metrics. Replacing it with an empirical survival curve is a Phase 3 optimization that
must beat it in replay before it ships.

```
predictedCapacity = agentsAvailable + expectedFreeWithinHorizon - agentsReserved
```

### 4.4 Deficit

```
inflightLive  = callsDialing * pLive + callsLiveWaiting
targetLive    = predictedCapacity * targetOccupancy
deficitLive   = targetLive - inflightLive
rawCount      = deficitLive <= 0 ? 0 : ceil(deficitLive / pLive)
```

### 4.5 Constraints (applied in order; the smallest wins and is recorded as `bindingConstraint`)

| Constraint             | Bound                                              |
| ---------------------- | -------------------------------------------------- |
| `MAX_LINES_PER_AGENT`  | `maxLinesPerAgent * agentsEligible - callsDialing` |
| `CAMPAIGN_CONCURRENCY` | `campaignConcurrencyRemaining`                     |
| `TENANT_CONCURRENCY`   | `tenantConcurrencyRemaining`                       |
| `GATEWAY_CAPACITY`     | `gatewayCapacityRemaining`                         |
| `MAX_CPS`              | `floor(maxCps * tickSeconds)`                      |
| `LEAD_INVENTORY`       | `callableLeads`                                    |
| `RAMP_LIMIT`           | `prev.originateCount * 1.5 + 1`                    |
| `ABANDON_DAMPING`      | see §4.6                                           |

`MAX_LINES_PER_AGENT` is the backstop that makes a `pLive` estimation error survivable: even
if `pLive` collapses to the floor, the dialer cannot exceed 4 lines per logged-in agent.

`RAMP_LIMIT` is the anti-oscillation control. Growth is geometric-with-offset so a campaign
starting from 0 can still ramp (0 → 1 → 2 → 4 → 7 → 11 …) while a spike is impossible.
Reduction is deliberately **not** rate-limited: pacing may fall to zero in a single tick.

### 4.6 Abandonment damping

```
if abandonRate >= abandonTarget:  0, and PAUSE_CAMPAIGN
if abandonRate >= abandonWarn:    multiply by 1 - (abandonRate - warn)/(target - warn)
```

Linear taper from full rate at the warn threshold to zero at the hard threshold, so the
controller decelerates _before_ the compliance ceiling rather than at it. Crossing the warn
threshold also emits a supervisor alert and is recorded as a compliance decision.

### 4.7 Confidence and mode degradation

```
attempts >= minSampleSize && agentsEligible >= 8  → HIGH   → PREDICTIVE
attempts >= minSampleSize/2 || agentsEligible >= 4 → MEDIUM → POWER
otherwise                                          → LOW    → PROGRESSIVE
```

Configured mode is a **ceiling**, never a floor: a campaign configured PREDICTIVE may run
PROGRESSIVE, but a campaign configured PROGRESSIVE never runs PREDICTIVE.

The `agentsEligible >= 8` gate is the mandate's §21 requirement that predictive not be used
for very small groups. With fewer than 8 agents the variance in agent-availability makes
predictive statistically indefensible: a single unexpected long call is a large fraction of
capacity, and the abandonment cost of being wrong lands on real people.

In PROGRESSIVE, §4.4 is bypassed entirely: `originateCount = min(agentsAvailable - callsDialing, …constraints)`.
Progressive can never intentionally create more live answers than available agents — this
is asserted directly in the test suite.

## 5. Degradation triggers (mandate §5.4 mapping)

| Trigger                   | Result                                                         |
| ------------------------- | -------------------------------------------------------------- |
| too few agents            | POWER or PROGRESSIVE (§4.7)                                    |
| unstable answer rate      | LOW confidence ⇒ degrade                                       |
| rising abandonment        | damping, then 0 (§4.6)                                         |
| stale heartbeats          | 0 (§4.1)                                                       |
| FS event lag              | 0 (§4.1)                                                       |
| Redis failure             | 0 (§4.1)                                                       |
| unknown active-call count | caller passes `redisHealthy:false` ⇒ 0                         |
| carrier failures          | `gatewayCapacityRemaining` → 0                                 |
| no valid caller ID        | campaign pause, upstream of the controller                     |
| high assignment latency   | damping via `assignmentLatencyMsP95`                           |
| queue overload            | `callsLiveWaiting` inflates `inflightLive` ⇒ deficit collapses |

Every degradation carries a `PacingReason` and is rendered verbatim in the supervisor UI.

## 6. Shadow mode

With `TENANT_DIALER_V2_SHADOW_ENABLED` and origination off, the controller runs against
**real** production agent and call state and persists every decision without originating.
The shadow report compares predicted vs. actual occupancy, abandonment, and agent
availability. Shipping gate for Phase 3: ≥ 14 days of shadow with agent-availability
forecast error within tolerance and zero would-have-exceeded-abandonment intervals.

## 7. Explicitly rejected approaches

- **Static lines-per-agent.** Ignores answer rate; this is what the mandate forbids.
- **ML pacing at this stage.** Nothing here is opaque; every number is traceable to a
  measured input. An ML model may replace §4.2/§4.3 only after beating them in replay.
- **Optimistic priors.** A new campaign must under-dial, not over-dial. Abandonment errors
  are asymmetric: idle agents cost money, abandoned calls cost regulatory exposure and
  reach real people.
