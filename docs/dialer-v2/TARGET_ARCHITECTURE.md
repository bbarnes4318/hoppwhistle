# DIALER V2 — TARGET ARCHITECTURE

## 1. Principle

Dialer V2 is a **separate, additive service**. It does not modify the Hopper, the human
softphone path, the Dograh integration, or FreeSWITCH configuration. It is off by default
and cannot originate a call until thirteen independent conditions are simultaneously true
(§5).

The existing stack is sufficient. **No Kafka, no NATS, no new datastore.** PostgreSQL is
durable truth, Redis is ephemeral coordination, FreeSWITCH ESL is the telephony event
source. Redis Streams cover the event spine at the scale targeted (§7).

## 2. Placement

```
apps/dialer-v2/
  src/
    config/        flags.ts, limits.ts          — kill switches, allowlists, ceilings
    runtime/       origination-gate.ts          — the 13-condition gate
    pacing/        controller.ts, forecast.ts   — the adaptive controller (pure)
    agents/        state.ts, presence.ts, reservations.ts
    leads/         selection.ts, leases.ts, recycle.ts
    origination/   originator.ts                — the single audited originate path
    events/        ingestor.ts, envelope.ts, dedupe.ts
    assignment/    live-answer.ts
    compliance/    gates.ts
    health/        server.ts
    sim/           simulator.ts                 — deterministic harness
packages/shared/src/dialer-v2/                  — event contracts + enums shared with api/web
```

`apps/dialer-v2` is a workspace package with its own container. It is **not** added to
`apps/worker`, so a crash or a bad deploy cannot take down billing, ClickHouse ETL, or the
Hopper.

## 3. Components

| Component              | Owns                                | Store                                    |
| ---------------------- | ----------------------------------- | ---------------------------------------- |
| Campaign Scheduler     | which campaigns may run this second | PG (config) + Redis (runtime)            |
| Lead Selection Engine  | which leads are next, leased        | PG `FOR UPDATE SKIP LOCKED` + lease rows |
| Agent Presence Service | authoritative agent state           | Redis (hot) + PG (audit trail)           |
| Reservation Service    | agent → future call binding         | Redis (atomic Lua) + PG                  |
| Pacing Controller      | how many calls to place             | pure function; inputs from Redis         |
| Origination Service    | the _only_ V2 originate             | PG attempt row → ESL                     |
| Event Ingestor         | normalize + dedupe FS events        | ESL → Redis Stream → PG                  |
| Live-Answer Assignment | bridge answer → agent               | Redis + ESL                              |
| Compliance Gate        | may we dial this number now         | PG + Redis caches                        |

### 3.1 Why the controller is a pure function

`decidePacing(inputs) → decision` has no I/O. That makes the highest-risk logic in the
product exhaustively testable without FreeSWITCH, without Redis, and without a database —
which is what makes the simulator in §20 of the mandate possible at all. Every input is
gathered by callers; every output is a decision plus a machine-readable reason.

## 4. Ownership and distribution

Every campaign is owned by exactly one V2 worker at a time via a Redis lease:

```
SET dialer2:{tenantId}:campaign:{campaignId}:owner <workerId> NX PX 15000
```

renewed every 5 s. Lease loss ⇒ the worker immediately stops originating for that campaign.
All rotation state (gateway index, caller-ID usage windows, concurrency counters) lives in
Redis, tenant-namespaced, so replicas coordinate rather than duplicate.

**Redis key convention — mandatory:**

```
dialer2:{tenantId}:campaign:{campaignId}:*
dialer2:{tenantId}:agent:{agentId}:*
dialer2:{tenantId}:callerid:{e164}:*
dialer2:global:*                         # only for platform-wide ceilings
```

The tenant segment is second and always present. This is enforced by a single key-builder
module; constructing a V2 Redis key by string concatenation anywhere else is a lint-level
error. This directly addresses `MULTITENANT_GAP_ANALYSIS.md` §6.

## 5. The origination gate

No code path may call ESL `originate` except `origination/originator.ts`, and that function
returns `{allowed:false, reason}` unless **all** hold:

1. `TENANT_DIALER_V2_ENABLED`
2. `TENANT_DIALER_V2_ORIGINATE_ENABLED`
3. `TENANT_DIALER_V2_DRY_RUN` is false
4. `TENANT_DIALER_V2_EMERGENCY_STOP` is false
5. tenant ∈ `TENANT_DIALER_V2_ALLOWED_TENANT_IDS`
6. campaign ∈ `TENANT_DIALER_V2_ALLOWED_CAMPAIGN_IDS` (or campaign allowlisting explicitly disabled)
7. FreeSWITCH ESL healthy
8. Redis healthy
9. PostgreSQL healthy
10. campaign ACTIVE and within schedule
11. compliance gate passed for this number
12. carrier and caller-ID capacity available
13. agent-state data fresh (if `TENANT_DIALER_V2_REQUIRE_HEALTHY_AGENT_HEARTBEATS`)
14. pacing controller permits another call

Failing conditions are returned as a list, not a boolean, so the supervisor UI can answer
"why is this campaign not dialing?" exactly (mandate §22).

**Defaults are all-off.** A fresh deploy with no env changes cannot place a call.

## 6. Interaction with the Hopper

They coexist. Separation is by campaign: a campaign carries `dialerVersion` (1 = Hopper,
2 = V2, default 1). V2 refuses any campaign not explicitly at version 2 _and_ allowlisted.
Because the Hopper currently cannot originate at all (`CURRENT_STATE_AUDIT.md` F-1), the
practical risk of double-dialing during migration is lower than it appears — but the
campaign-level split is enforced regardless, so it stays correct once F-1 is fixed.

## 7. Why Redis Streams, not Kafka

Target scale is hundreds of agents and low-thousands of concurrent calls. At 20 events per
call and 2,000 concurrent calls with 3-minute handle time, the sustained rate is roughly
200 events/s with bursts under 2,000/s — two orders of magnitude inside what a single
Redis instance handles. Streams give consumer groups, at-least-once delivery, and replay
via `XRANGE`, which is all the event spine needs. PG remains the durable record; Redis is
the transport. Revisit only if measured lag exceeds budget under load test.

## 8. Failure posture

Every dependency failure degrades toward **fewer calls**, never more:

| Failure                   | Behavior                                                               |
| ------------------------- | ---------------------------------------------------------------------- |
| Redis unavailable         | stop originating (coordination lost ⇒ cannot guarantee no double-dial) |
| PG unavailable            | stop originating (cannot durably record an attempt)                    |
| ESL down                  | stop originating                                                       |
| Event lag > threshold     | stop predictive; degrade to progressive                                |
| Agent heartbeats stale    | remove agents from capacity; degrade                                   |
| Campaign lease lost       | stop that campaign immediately                                         |
| Unknown active-call count | stop                                                                   |

There is no path in which uncertainty increases call volume.
