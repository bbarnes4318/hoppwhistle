# DIALER V2 — PHASE 1 OPERATIONS

What exists after Phase 1, how to run it, and what it still cannot do.

## 1. What Phase 1 delivers

Event ingestion, authoritative agent state, reconciliation, shadow pacing, a
read-only supervisor screen, and a read-only Hopper diagnostic.

**There is still no origination path.** Not "disabled" — absent. The ESL client's
only write to FreeSWITCH is its event subscription, and that is asserted by a test
which inspects every command the client issues.

## 2. Running it

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.dialer-v2.yml up -d dialer-v2
```

Endpoints on port 9092 (internal only — not internet-exposed):

| Path                                    | Purpose                                                |
| --------------------------------------- | ------------------------------------------------------ |
| `/health/live`                          | process liveness                                       |
| `/health`, `/health/ready`              | dialing readiness; 503 when ingestion is untrustworthy |
| `/status/flags`                         | current kill-switch values, no secrets                 |
| `/status/ingestion`                     | ingestion metrics, event age, lag                      |
| `/internal/shadow/decisions?tenantId=…` | shadow decisions; consumed by `apps/api` only          |

Supervisor screen: **`/dialer-v2-shadow`** in the web app.
API: `GET /api/v1/dialer-v2/shadow/status` and `/decisions`, both authenticated
and scoped to the caller's verified tenant.

## 3. Hopper preflight

```bash
pnpm --filter @hopwhistle/api hopper:preflight
```

Answers, against the live database, whether `LeadStatus` contains `DIALING` and
how many calls a Hopper repair would place immediately. Every statement is a
SELECT; the ESL check is a bare TCP connect closed without writing or reading.

Exit codes: `0` normal, `1` error, **`2` a repair would start real calls now**.

Run this before authorising any Hopper change. `CURRENT_STATE_AUDIT.md` F-1 is a
static-analysis finding; F-2 established that `schema.prisma` is not the deployed
schema, so the live enum has to be checked rather than assumed.

## 4. Health semantics

Readiness fails when ingestion is untrustworthy, not only when a dependency is
down. A dialer that cannot see telephony events cannot safely pace, and a green
check in that state is worse than no check — that is exactly the failure mode
`CURRENT_STATE_AUDIT.md` §5 documents in the existing worker.

Liveness stays true through dependency failure so an orchestrator does not
restart-loop a service that is correctly refusing to dial.

Three distinct ESL conditions, deliberately not collapsed:

- **disconnected** — socket is down; reconnecting with bounded backoff.
- **degraded** — connected, but no event has arrived within the staleness window.
  A quiet socket is a different fault from a dead one and needs a different fix.
- **connected** — events flowing.

## 5. Event attribution

Events carry the tenant in `variable_hopwhistle_tenant_id`, set at originate time
by the Hopper today and by Dialer V2 later.

An event whose tenant cannot be proven is **quarantined** — not dropped, not
assigned a default. Assigning a fallback tenant is a cross-tenant data leak;
dropping it hides a correlation bug. Quarantine makes it visible and recoverable.
A tenant id that is reserved (`global`, `platform`, `admin`, …) or contains a
Redis delimiter or glob character is quarantined for the same reason.

`unresolved_events > 0` on the health surface means correlation is failing
somewhere and needs investigation before pacing on that tenant's data.

## 6. Agent capacity

Only `AVAILABLE` counts as immediately usable capacity. `PAUSED`, `BREAK`,
`TRAINING` are logged in but not dialable. `STALE` is excluded entirely.

An agent is marked `STALE` when the browser heartbeat expires, the SIP
registration disappears past the grace period, or a second browser session claims
the same agent.

Reconciliation compares browser state, service state, SIP registration, and live
FreeSWITCH channels. On conflict it fails safe. The asymmetry is the whole point:
an over-counted agent produces an answered call with nobody to take it; an
under-counted agent is idle for a few seconds.

Every automatic correction records a machine-readable reason
(`heartbeat_expired`, `browser_on_call_but_no_channel`,
`channel_exists_but_agent_state_available`, `duplicate_active_session`, …) and a
human-readable detail.

## 7. Shadow mode

`TENANT_DIALER_V2_ENABLED=true`, `TENANT_DIALER_V2_SHADOW_ENABLED=true`, plus a
tenant allowlist. Origination flags stay off — and would not matter if they were
on, because the shadow engine imports nothing that can write to FreeSWITCH.

Each decision persists the full input vector, the recommended count, the binding
constraint, the degradation mode, the safety reasons, the controller version, and
`originated: false`.

The API drops any record claiming a call was originated. Shadow mode cannot
originate, so such a record would be corrupt and must not reach a supervisor.

Phase 3 gate: ≥ 14 days of shadow with forecast error in tolerance and zero
would-have-exceeded-abandonment intervals.

## 8. Known limitations

1. **Stores are in-memory.** `EventStore`, `DedupeStore`, and
   `ShadowDecisionStore` have PostgreSQL/Redis implementations pending. Decisions
   and events do not survive a restart, and a second replica would not share
   dedupe state. The interfaces are stable; the implementations are additive.
2. **The ESL client is not started by the entrypoint.** No telephony credentials
   are assumed in this build, so `/health` honestly reports ESL as disconnected.
   Wiring it is a config change plus a start call, gated on staging validation.
3. **The reconcile loop is not scheduled.** `AgentStateService.reconcile()` is
   fully implemented and tested but is not yet driven by a timer, so
   `reconciliationLagMs` reports null.
4. **Agent heartbeats have no HTTP endpoint yet.** The service method and its
   semantics exist; the authenticated route that browsers call does not.
5. **Shadow observations are not yet assembled from live data.** `ShadowEngine`
   consumes a `ShadowObservation`; the collector that builds one from the
   ingestor and agent service each second is Phase 1 remaining work.
6. **No Prisma migration has been written or applied.** `DATA_MODEL.md` §2
   explains why: migration history does not describe production, so the first
   step is `prisma migrate diff` against the live database, reviewed by a human.

## 9. Production changes deliberately not made

None of the following was done, and each needs explicit authorisation:

- No FreeSWITCH configuration, dialplan, or gateway change.
- No carrier or caller-ID routing change.
- No production DDL. No migration applied.
- No Hopper repair. `LeadStatus` was not modified.
- No secret or certificate rotation.
- No deployment to production.
- Dialer V2 origination was not enabled, because it does not exist yet.
