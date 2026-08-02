# DIALER V2 — DATA MODEL

## 1. Rules

- **Additive only.** No column or table in the existing schema is renamed, retyped, or
  dropped in Phases 0–3. Existing tenant, user, campaign, phone-number, call, and recording
  IDs stay valid.
- All new tables are prefixed `dialer_v2_` and all models `DialerV2*`, so ownership is
  unambiguous and a full rollback is `DROP TABLE`-shaped.
- Every table carries `tenantId` with an index leading on it. There is no V2 table without
  a tenant column, including logs.
- Existing V1 behavior is untouched: `leads.status` semantics do not change, and V2 does
  **not** write `leads.status`. V2 tracks its own lifecycle in `dialer_v2_call_attempts`,
  which is how it avoids `CURRENT_STATE_AUDIT.md` F-1 entirely rather than inheriting it.

## 2. Migration strategy — important caveat

`CURRENT_STATE_AUDIT.md` F-2 established that the `leads` table and the `LeadStatus` enum
exist in `schema.prisma` but in **no migration**: the deployed database was produced by
`prisma db push`, so `migrations/` does not describe production.

Consequences for V2:

1. `prisma migrate deploy` against production **cannot be assumed safe** until drift is
   measured. The first deployment step is `prisma migrate diff --from-url $PROD --to-schema-datamodel`
   captured to a file and reviewed by a human.
2. V2 migrations are written to be **drift-tolerant**: `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, no `ALTER` of pre-existing objects.
3. Baselining the existing schema into migration history is prerequisite work, tracked in
   `ROLLOUT_AND_ROLLBACK.md` §6 as a separate authorized change. **It is not done inside
   this feature branch** — it is a production DDL change to protected tables.

## 3. Tables

### Configuration

**`dialer_v2_campaign_config`** — one row per campaign opted into V2.
`campaignId` (unique, FK), `tenantId`, `dialerVersion` (default 1), `dialingMode`,
`enabled`, pacing policy (`targetOccupancy`, `abandonTarget`, `abandonWarn`,
`maxLinesPerAgent`, `maxCps`, `maxConcurrent`, `minSampleSize`), attempt policy
(`maxAttempts`, `attemptSpacingMinutes`, retry intervals per outcome, `recycleRules` JSON),
schedule (`scheduleJson`, `timezoneMode`, `holidayCalendarId`), `amdPolicy`,
`recordingPolicy`, `wrapUpSeconds`, `safeHarborAudioUrl`, `compliancePolicyId`,
`callerIdPolicy`, `inboundReservePct`, `screenPopUrl`, `scriptId`.
→ `@@unique([campaignId])`, `@@index([tenantId, enabled])`

**`dialer_v2_campaign_runtime`** — mutable per-campaign runtime.
`campaignId`, `tenantId`, `state` (`STOPPED|STARTING|RUNNING|DRAINING|PAUSED|EMERGENCY_STOPPED`),
`effectiveMode`, `pausedReason`, `ownerWorkerId`, `leaseExpiresAt`, `lastDecisionAt`,
counters, `updatedAt`.
→ `@@unique([campaignId])`, `@@index([tenantId, state])`, `@@index([leaseExpiresAt])`

### Agents

**`dialer_v2_agent_state`** — authoritative agent state, PG-durable mirror of Redis.
`tenantId`, `userId`, `extension`, `state` (the 19 states in mandate §4.3), `campaignIds[]`,
`queueIds[]`, `skills` JSON, `currentCallId`, `currentReservationId`, `lastHeartbeatAt`,
`lastTelephonyEventAt`, `sipRegistered`, `browserConnected`, `pauseCode`,
`wrapUpExpiresAt`, `maxSimultaneousCalls`, `inboundEligible`, `outboundEligible`,
`sessionStartedAt`, `stateChangedAt`.
→ `@@unique([tenantId, userId])`, `@@index([tenantId, state])`, `@@index([lastHeartbeatAt])`

**`dialer_v2_agent_state_transition`** — append-only audit of every transition
(`fromState`, `toState`, `reason`, `source`, `at`). Feeds agent reporting in mandate §14.

**`dialer_v2_agent_skill`** — `tenantId`, `userId`, `skill`, `level`.

**`dialer_v2_agent_reservation`** — `tenantId`, `campaignId`, `userId`, `state`
(`PENDING|ASSIGNED|CONSUMED|EXPIRED|CANCELLED`), `expectedAvailableAt`, `expiresAt`,
`attemptId`, `assignmentDeadlineAt`, `cancelReason`.
→ partial unique on `(tenantId, userId)` where `state IN ('PENDING','ASSIGNED')` — the
database-level guarantee that one agent cannot be double-reserved.
→ `@@index([expiresAt])`

### Dialing

**`dialer_v2_lead_lease`** — `tenantId`, `campaignId`, `leadId`, `phoneNumber`, `workerId`,
`acquiredAt`, `expiresAt`, `attemptId`, `releasedAt`.
→ **partial unique on `(leadId)` where `releasedAt IS NULL`** — the database-level
guarantee against double-dialing (`CURRENT_STATE_AUDIT.md` F-4). Selection uses
`SELECT … FOR UPDATE SKIP LOCKED` and inserts the lease in the same transaction.
→ `@@index([expiresAt])` for reaper recovery.

**`dialer_v2_call_attempt`** — the first-class attempt record (mandate §8).
`tenantId`, `campaignId`, `listId`, `leadId`, `phoneNumber`, `agentId`, `callerId`,
`gateway`, `dialingMode`, `attemptNumber`, `idempotencyKey`, `freeswitchUuid`,
`startedAt`, `progressAt`, `answeredAt`, `bridgedAt`, `endedAt`, `hangupCause`,
`amdResult`, `amdConfidence`, `disposition`, `recordingId`, `retryEligibleAt`,
`complianceDecisionId`, `pacingDecisionId`, `reservationId`, `state`.
→ `@@unique([idempotencyKey])` — makes origination idempotent.
→ partial unique on `(leadId)` where `state IN ('PENDING','DIALING','RINGING','ANSWERED','BRIDGED')`
— no two simultaneously active attempts against one lead.
→ `@@unique([freeswitchUuid])`, `@@index([tenantId, campaignId, startedAt])`,
`@@index([phoneNumber, startedAt])`, `@@index([retryEligibleAt])`

**`dialer_v2_callback`** — `tenantId`, `campaignId`, `leadId`, `agentId` (null ⇒ any-agent),
`dueAt`, `contactTimezone`, `state`, `notes`. → `@@index([tenantId, dueAt, state])`

### Control-plane records

**`dialer_v2_pacing_decision`** — `tenantId`, `campaignId`, `decidedAt`, `mode`,
`originateCount`, `bindingConstraint`, `reasons[]`, `pLive`, `predictedCapacity`,
`predictedLiveAnswers`, `confidence`, `inputs` JSON, `shadow` (bool).
Full input vector stored so every decision is reproducible offline. Retention 30 days hot;
this table is high-volume (~1 row/campaign/second) and is partitioned by day.

**`dialer_v2_compliance_decision`** — `tenantId`, `campaignId`, `leadId`, `phoneNumber`,
`decision` (`ALLOW|BLOCK`), `rule`, `detail`, `overrideId`, `decidedAt`. Append-only,
never updated or deleted — this is the evidence trail.

**`dialer_v2_caller_id_usage`** — `tenantId`, `phoneNumberId`, `e164`, `windowStart`,
`windowKind` (`HOUR|DAY`), `attempts`, `answers`, `concurrent`, `quarantinedUntil`,
`spamStatus`, `lastUsedAt`. → `@@unique([phoneNumberId, windowKind, windowStart])`

**`dialer_v2_gateway_runtime`** — `gateway`, `tenantId?`, `healthy`, `cpsUsed`,
`concurrentUsed`, `consecutiveFailures`, `circuitState`, `openedAt`.

**`dialer_v2_circuit_breaker`** — `scope` (`TENANT|CAMPAIGN|CARRIER|CALLER_ID`), `scopeId`,
`state` (`CLOSED|OPEN|HALF_OPEN`), `reason`, `openedAt`, `nextProbeAt`.

**`dialer_v2_audit_event`** — every supervisor/admin mutation: `tenantId`, `actorUserId`,
`action`, `targetType`, `targetId`, `before` JSON, `after` JSON, `at`, `ip`. Append-only.

**`dialer_v2_queue`** / **`dialer_v2_queue_membership`** — ACD definitions (Phase 4).

**`dialer_v2_suppression_decision`** — DNC/suppression hits, separate from
`compliance_decision` for reporting volume reasons.

## 4. Enums

`DialerV2Mode` (`MANUAL|CLICK_TO_CALL|PREVIEW|PROGRESSIVE|POWER|PREDICTIVE|AGENTLESS|AI_VOICE|AI_TO_HUMAN_TRANSFER|INBOUND|BLENDED`),
`DialerV2AgentState` (19 members per mandate §4.3),
`DialerV2AttemptState`, `DialerV2AmdResult` (`HUMAN|MACHINE|FAX|SIT|BUSY|NO_ANSWER|INVALID|UNKNOWN`),
`DialerV2CampaignState`, `DialerV2ReservationState`, `DialerV2CircuitState`.

New enums only — no member is added to any existing enum in this branch.

## 5. Indexes required by the mandate (§17)

tenant+status ✔ · campaign+status ✔ · agent+state ✔ · lead+active attempt ✔ (partial unique)
· phone+attempt time ✔ · callback due ✔ · reservation expiry ✔ · event correlation ✔
(`freeswitchUuid` unique) · pacing decision time ✔ · compliance lookup ✔ · caller-ID usage
windows ✔

## 6. Retention

| Table                    | Hot                                    | Then                                                  |
| ------------------------ | -------------------------------------- | ----------------------------------------------------- |
| `pacing_decision`        | 30 d                                   | aggregate → drop                                      |
| `agent_state_transition` | 90 d                                   | archive                                               |
| `call_attempt`           | 13 mo                                  | archive, never delete while a recording references it |
| `compliance_decision`    | per compliance policy, **minimum 5 y** | immutable archive                                     |
| `audit_event`            | 7 y                                    | immutable archive                                     |
