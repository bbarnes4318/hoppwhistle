# DIALER V2 — EVENT MODEL

## 1. Envelope

Every event — telephony, agent, pacing, compliance, supervisor — is normalized into one
versioned envelope before it touches any consumer.

```ts
interface DialerV2Event<T = unknown> {
  eventId: string; // deterministic (§4) — the dedupe key
  eventVersion: 1;
  type: DialerV2EventType;
  occurredAt: string; // ISO-8601, source clock
  ingestedAt: string; // ISO-8601, our clock — the gap is the lag metric
  tenantId: string; // never optional; unattributable events are quarantined (§5)
  campaignId?: string;
  leadId?: string;
  attemptId?: string;
  callId?: string;
  freeswitchUuid?: string;
  agentId?: string;
  callerId?: string;
  destination?: string; // redacted per policy in logs, never in the record
  gateway?: string;
  disposition?: string;
  hangupCause?: string;
  rawRef?: string; // Redis Stream ID of the raw event, for forensics
  payload: T;
}
```

`eventVersion` is present from the first event so consumers can branch without a migration.
Adding an optional field does not bump the version; changing or removing a field does, and
both versions are then supported for one full release cycle.

## 2. Ingested FreeSWITCH events

`CHANNEL_CREATE`, `CHANNEL_ORIGINATE`, `CHANNEL_PROGRESS`, `CHANNEL_PROGRESS_MEDIA`,
`CHANNEL_ANSWER`, `CHANNEL_BRIDGE`, `CHANNEL_UNBRIDGE`, `CHANNEL_HANGUP`,
`CHANNEL_HANGUP_COMPLETE`, `RECORD_START`, `RECORD_STOP`, `DTMF`, plus `CUSTOM` subclasses
for queue and AMD.

Correlation is by channel variables set at originate time:

```
hopwhistle_tenant_id, hopwhistle_campaign_id, hopwhistle_lead_id   # existing (V1)
hopwhistle_attempt_id, hopwhistle_pacing_decision_id,
hopwhistle_reservation_id, hopwhistle_dialer_version=2             # V2 additions
```

Keeping the three existing variable names unchanged means the V1 dialplan and any existing
CDR consumers continue to work; `hopwhistle_dialer_version` is what lets V1 and V2 traffic
be told apart in FreeSWITCH, in logs, and in CDRs.

**The ingestor subscribes; it does not modify dialplan XML.** No FreeSWITCH configuration
change is required for Phase 1, which keeps ingestion outside the telephony change-control
gate (`PROTECTED_SYSTEM_INVARIANTS.md` §4).

## 3. Internal event types

- Agent: `AGENT_STATE_CHANGED`, `AGENT_HEARTBEAT`, `AGENT_STALE`, `AGENT_LOGGED_OUT`
- Reservation: `RESERVATION_CREATED|ASSIGNED|CONSUMED|EXPIRED|CANCELLED`
- Attempt: `ATTEMPT_CREATED|ORIGINATED|PROGRESSED|ANSWERED|BRIDGED|ENDED|FAILED`
- Assignment: `LIVE_ANSWER_QUEUED|ASSIGNED|BRIDGE_FAILED|ABANDONED|SAFE_HARBOR_PLAYED`
- Pacing: `PACING_DECIDED`, `PACING_DEGRADED`, `PACING_CONSTRAINED`
- Compliance: `COMPLIANCE_BLOCKED`, `COMPLIANCE_OVERRIDDEN`, `ABANDON_THRESHOLD_WARNED|BREACHED`
- Control: `CAMPAIGN_STARTED|PAUSED|DRAINING|STOPPED`, `EMERGENCY_STOP_ENGAGED|CLEARED`,
  `CIRCUIT_OPENED|CLOSED`
- Health: `DEPENDENCY_DEGRADED`, `EVENT_LAG_EXCEEDED`

## 4. Determinism, dedupe, and replay

`eventId = sha256(source | freeswitchUuid | eventName | occurredAt | sequence)`.

Derived rather than random, so the _same_ physical event redelivered by ESL after a
reconnect produces the _same_ id. Dedupe is a Redis `SET NX` on
`dialer2:{tenantId}:evt:{eventId}` with a 24 h TTL, backed by the unique constraint on
`dialer_v2_call_attempt.freeswitchUuid` for the events that mutate attempt state.

Consumers must be idempotent regardless — the Redis set is an optimization, not the
correctness guarantee. The mandate's requirement that "duplicate telephony events do not
duplicate billing, dispositions, or attempts" is asserted directly in the test suite by
replaying a captured stream twice and diffing final state.

Raw events land in `dialer2:global:raw` (a capped Redis Stream) before normalization, so a
normalization bug can be fixed and the stream replayed rather than losing the data.

## 5. Unattributable events

An event with no resolvable `tenantId` is **not** dropped and **not** assigned a default
tenant. It goes to `dialer2:global:quarantine` and increments
`dialer_v2_events_unattributed_total`. Assigning a fallback tenant would be a cross-tenant
data leak; dropping it would hide a correlation bug. Quarantine makes it visible and
recoverable.

## 6. Ordering

Redis Streams are per-key ordered, and the stream is keyed by `freeswitchUuid`, so all
events for one channel are ordered. Cross-channel ordering is **not** guaranteed and no
consumer may depend on it.

Out-of-order arrival within a channel is still possible across an ESL reconnect, so attempt
state transitions are guarded by a monotonic state rank: an event that would move an
attempt backwards (e.g. `PROGRESS` after `ANSWER`) updates timestamps only and is counted
in `dialer_v2_events_out_of_order_total`.

## 7. Real-time fan-out

Consumers subscribe to the normalized stream, not to ESL:

- Supervisor WebSocket — campaign metrics, agent grid, pacing reasons
- Agent WebSocket — screen pop, reservation, wrap-up timer, state
- Reporting ETL → PG aggregates → existing ClickHouse ETL
- Metrics exporter → Prometheus

WebSocket subscriptions are authorized per tenant at connect time and the tenant is taken
from the verified session, never from a client-supplied parameter.

## 8. Lag budget

| Hop                       | Budget       |
| ------------------------- | ------------ |
| FS → ingestor             | 100 ms       |
| normalize + dedupe        | 20 ms        |
| → pacing controller input | 250 ms total |
| → supervisor UI           | 1 s          |
| → PG durable              | 5 s          |

`occurredAt → ingestedAt` is exported as `dialer_v2_event_lag_ms`. Exceeding the pacing
budget is a §4.1 hard stop in the controller: predictive dialing on stale telemetry is
exactly how abandonment spikes.
