# DIALER V2 — CURRENT STATE AUDIT

> Read-only audit of the dialing path as it exists on `main` at commit `7cc520db`.
> Every claim below was verified against runtime code in this repository. Where the
> existing `docs/saas/*` documents disagree with the code, the code wins and the
> discrepancy is called out.

---

## 0. Executive summary

| #    | Finding                                                                                                                                                                             | Severity    | Evidence                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------- |
| F-1  | **The Hopper cannot dial. It throws on every loop iteration that finds a lead.** `LeadStatus` has no `DIALING` member, but the Hopper casts to it.                                  | 🔴 Critical | `dialer-worker.ts:273` vs `schema.prisma:1891`           |
| F-2  | The `leads` table and `LeadStatus` enum exist in `schema.prisma` but in **no migration** — the deployed DB was produced by `db push`. Migration history is not the source of truth. | 🔴 Critical | `apps/api/prisma/migrations/**` contains no `LeadStatus` |
| F-3  | Capacity is a single global `MAX_CONCURRENT_CALLS` across **all tenants and campaigns**. One tenant can starve every other tenant.                                                  | 🔴 Critical | `dialer-worker.ts:22,256`                                |
| F-4  | Lead selection has **no locking and no lease**. Two Hopper replicas select the same rows.                                                                                           | 🔴 Critical | `dialer-worker.ts:325-338` (plain `SELECT ... LIMIT`)    |
| F-5  | There is **no kill switch**. Stopping the dialer requires stopping the worker process.                                                                                              | 🔴 Critical | `index.ts:62` — unconditional `dialerWorker.start()`     |
| F-6  | `FALLBACK_CALLER_ID` hard-codes `+18656000124` and is used whenever a tenant's pool is empty — including for a _different_ tenant.                                                  | 🔴 Critical | `dialer-worker.ts:40,96-98`                              |
| F-7  | No agent awareness of any kind. The Hopper does not know whether a single agent is logged in.                                                                                       | 🟠 High     | entire file — no agent query exists                      |
| F-8  | Originate result is fire-and-forget. The channel UUID is discarded, so no call attempt is durably recorded and no FreeSWITCH event can be correlated.                               | 🟠 High     | `dialer-worker.ts:378-390`                               |
| F-9  | `getActiveCallCount()` trusts a Redis key `dialer:active_calls` that **nothing in the repository ever writes**.                                                                     | 🟠 High     | `dialer-worker.ts:289-297`; no writer found              |
| F-10 | In-process `currentActiveCalls` only ever increments — it is never decremented.                                                                                                     | 🟠 High     | `dialer-worker.ts:385`                                   |

**Bottom line:** the current Hopper is not a predictive dialer, and as committed it is not
a working dialer either. Dialer V2 is not an optimization of this component; it is a
replacement built alongside it.

---

## 1. F-1 — The Hopper throws on every productive loop iteration

This is the most consequential finding, so it is documented in full.

The Hopper marks a lead `DIALING` before originating:

```ts
// apps/worker/src/services/dialer-worker.ts:271-281
for (const lead of leads) {
  // Immediately mark as DIALING to prevent re-fetch
  await this.updateLeadStatus(lead.id, 'DIALING');
  this.originateCall(lead).catch(...)
}
```

`updateLeadStatus` casts the string to the Postgres enum:

```ts
// apps/worker/src/services/dialer-worker.ts:396-401
await this.prisma.$executeRaw`
  UPDATE "leads" SET status = ${status}::"LeadStatus", "updatedAt" = NOW() WHERE id = ${leadId}
`;
```

But `LeadStatus` has no `DIALING` member:

```prisma
// apps/api/prisma/schema.prisma:1891-1902
enum LeadStatus {
  NEW
  CONTACTED
  QUALIFIED
  CONVERTED
  LOST
  DO_NOT_CALL
}
```

Postgres therefore raises `invalid input value for enum LeadStatus: "DIALING"` on the
**first lead of every batch**. Because the `await` is inside the `for` loop and outside
any `try`, the rejection propagates out of `runDialerLoop()` into the interval handler,
which swallows it into a log line:

```ts
// apps/worker/src/services/dialer-worker.ts:157-161
this.intervalId = setInterval(() => {
  this.runDialerLoop().catch((err: unknown) => {
    logger.error({ msg: 'DialerWorker loop error', error: err });
  });
}, DIALER_POLL_INTERVAL_MS);
```

### Consequences

1. `originateCall()` is **never reached** when leads are present. No call is placed.
2. No lead status ever changes, so the identical rows are re-selected on the next tick.
3. The loop runs at `DIALER_POLL_INTERVAL_MS` (default **1000 ms**), so this produces a
   sustained ~1 Hz error-log and ~1 Hz `SELECT` against `leads ⋈ campaigns`, forever.
4. The failure is invisible at the process level — the worker stays "healthy", the
   `/health` endpoint returns `ok`, and the metrics server keeps serving.

### Corroborating evidence

The dead Autodialer carries a comment showing this exact bug was hit before and worked
around there rather than fixed at the source:

```ts
// apps/worker/src/services/autodialer.ts:89
// 2. Update Status (Use 'CONTACTED' instead of 'DIALING' to prevent crash)
```

### Why this is not fixed in this branch

Fixing the Hopper means editing `dialer-worker.ts`, which `PROTECTED_SYSTEM_INVARIANTS.md`
§1 lists as a protected legacy worker ("**live production dialer — The Hopper**") and
instructs not to edit in early phases. The remediation is recorded in
`ROLLOUT_AND_ROLLBACK.md` §6 as a separate, independently reviewable change requiring
explicit authorization, because adding a `DIALING` enum member is a production DDL change
and because un-breaking the Hopper would _start real outbound calls_ on a system that has
had none from this path.

> **This finding materially changes the rollback story.** "Roll back to the current
> Hopper" is not a return to a working dialer. See `ROLLOUT_AND_ROLLBACK.md` §1.

---

## 2. What the Hopper actually does

Confirmed control flow (`apps/worker/src/services/dialer-worker.ts`):

1. `start()` — connects ESL, then `setInterval(runDialerLoop, 1000)`.
2. `runDialerLoop()`:
   - reconnect ESL if the connection dropped;
   - `getActiveCallCount()`; compute `availableSlots = MAX_CONCURRENT_CALLS - active`;
   - `fetchLeadsToDial(min(availableSlots, DIALER_BATCH_SIZE))`;
   - per lead: mark `DIALING` **(throws — F-1)**, then `originateCall()`.
3. `originateCall()` builds `originate {vars}sofia/gateway/<fractelN>/<E.164> &socket(host:port async full)`
   and fires it via `bgapi`.

### Lead selection query (verbatim)

```sql
SELECT l.id, l."phoneNumber", l."campaignId", c."tenantId", c.name as campaign_name
FROM "leads" l
INNER JOIN "campaigns" c ON l."campaignId" = c.id
WHERE l.status = 'NEW' AND c.status = 'ACTIVE'
ORDER BY l."createdAt" ASC
LIMIT ${limit}
```

Everything Dialer V2 must add is visible in what this query omits: no `FOR UPDATE SKIP
LOCKED`, no lease, no attempt count, no retry schedule, no time-zone or calling-hours
predicate, no DNC join, no consent check, no per-tenant or per-campaign budget, no list
priority, no callback handling, no alternate phone numbers, no suppression, no
duplicate-active-attempt guard.

### Gateway and caller-ID selection

- Gateways: a module-level `gatewayRotationIndex` round-robins `fractel1..fractel6`
  (`:29-37`). It is **process-local**, so N replicas rotate independently and correlated
  bursts to one gateway are possible.
- Caller ID: `getNextCallerId(tenantId)` reads `PhoneNumber where {tenantId, provider:'fractel', status:'ACTIVE', poolType:'POOL'}`,
  cached 60 s, round-robined per tenant (`:84-102`). This part is genuinely tenant-scoped
  and is the one piece of the Hopper Dialer V2 should carry forward in spirit.
- **But** when a tenant's pool is empty it returns the hard-coded `FALLBACK_CALLER_ID`
  (`+18656000124`), which belongs to whichever tenant owns it — a cross-tenant caller-ID
  leak and an unverified-CID risk given the July 2026 toll-fraud incident. Dialer V2
  pauses the campaign instead (see `COMPLIANCE_CONTROLS.md` §5).

### Channel variables set

`ignore_early_media=true`, `origination_caller_id_number`, `origination_caller_id_name=Hopwhistle`,
`hopwhistle_lead_id`, `hopwhistle_campaign_id`, `hopwhistle_tenant_id`.

Useful precedent: tenant/campaign/lead already ride on the channel. Dialer V2 extends this
set with `attempt_id`, `pacing_decision_id`, `reservation_id`, and `dialer_version=2` so
V1 and V2 traffic are distinguishable in FreeSWITCH and in CDRs.

---

## 3. Concurrency and capacity accounting

Three independent sources of "active calls", none authoritative:

| Source                          | Written by                | Problem                                                                                                                                                                                             |
| ------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redis GET dialer:active_calls` | **nothing in this repo**  | A grep across `apps/` and `packages/` finds no writer. If the key is ever set by hand it becomes a permanently stale ceiling.                                                                       |
| `show calls count` via ESL      | FreeSWITCH                | Counts **every** channel on the box — agent softphone calls, inbound DID traffic, AI Voice legs — not just this dialer's. Outbound pacing is therefore throttled by unrelated inbound volume.       |
| `this.currentActiveCalls`       | `originateCall()` success | Incremented at `:385`, **never decremented anywhere**. Once the other two sources fail, this monotonically increasing counter permanently pins `availableSlots <= 0` and the dialer silently stops. |

`MAX_CONCURRENT_CALLS` (default 10) is global. There is no per-tenant, per-campaign,
per-gateway, or per-caller-ID limit. This is the single largest multi-tenant blocker in the
dialing path and is why `DialerConcurrencyLimit` and tenant-scoped Redis counters are
Phase 0 work rather than Phase 5 polish.

---

## 4. Distribution and ownership

The Hopper holds all state in process memory: `gatewayRotationIndex`, `didPoolCache`,
`didRotationIndex`, `currentActiveCalls`, `isRunning`.

Running two worker replicas today would:

- double-dial every lead (no lease — F-4);
- double the effective concurrency ceiling (each replica enforces its own `MAX_CONCURRENT_CALLS`);
- desynchronize caller-ID rotation, over-using some DIDs and starving others.

`CURRENT_WORKER_STARTUP_MAP.md` describes a single worker container, which is the only
reason this has not caused an incident. **Horizontal scaling of the current worker is
unsafe and must not be attempted before Dialer V2.**

---

## 5. Observability

`apps/worker/src/index.ts` exposes `/metrics` (prom-client) and `/health`. Neither reflects
dialer state: `/health` is a static `{status:'ok'}` literal, and no dialer-specific metric
is registered. F-1 is therefore completely invisible to monitoring — the process is up,
`/health` is green, and the dialer has never placed a call.

Health endpoints that assert _dialing_ liveness (ESL reachable, event lag, agent-state
freshness, origination permitted) are Phase 0 deliverables.

---

## 6. Compliance posture of the current path

The schema already contains `DncList`, `DncListEntry`, `ConsentToken`, `CompliancePolicy`,
`ComplianceOverride`, and `StirShakenStatus` — good foundations. **The Hopper consults none
of them.** There is no DNC check, no consent check, no calling-hours check, no contact
local-time calculation, no attempt limit, and no abandonment measurement in the dialing
path.

Because of F-1 this has not produced live exposure from this component. It does mean the
compliance control plane is genuinely net-new code, not a refactor.

---

## 7. Corrections to existing documentation

| Doc                                   | Claim                                               | Verified reality                                                                                            |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PROTECTED_SYSTEM_INVARIANTS.md` §3.4 | "The Hopper is the single active background dialer" | Accurate as _intent_; it is the single **registered** dialer, but it does not successfully originate (F-1). |
| `PROTECTED_SYSTEM_INVARIANTS.md` §1   | Autodialer "(dead)"                                 | Confirmed — commented out at `apps/worker/src/index.ts:73`.                                                 |
| Mandate §2                            | Hopper "Marks them DIALING"                         | It _attempts_ to; the write fails (F-1).                                                                    |
| Mandate §2                            | Hopper "Originates calls through FreeSWITCH ESL"    | The code path exists and is correct, but is unreachable whenever leads are present.                         |
| Several `docs/*`                      | Autodialer active, didcentral gateway active        | Confirmed stale; FracTEL `fractel1-6` only.                                                                 |

---

## 8. What is worth preserving

Not everything here is wrong. Dialer V2 should carry forward:

1. **Per-tenant DID pool caching with TTL** (`getNextCallerId`) — correct shape, needs
   limits, cooldowns, and removal of the hard-coded fallback.
2. **`hopwhistle_*` channel variables** — extend, do not replace.
3. **`&socket(... async full)` handoff** — the existing integration point with the
   outbound-socket application; V2 keeps this contract.
4. **FracTEL gateway rotation** — correct default carrier; move rotation state to Redis.
5. **ESL reconnect-on-loop** — the intent is right; V2 makes ESL health a first-class,
   observable gate rather than a silent skip.

---

## 9. Audit method

- Read in full: `apps/worker/src/services/dialer-worker.ts`, `apps/worker/src/index.ts`,
  `docs/saas/PROTECTED_SYSTEM_INVARIANTS.md`.
- Schema: `apps/api/prisma/schema.prisma` (2,963 lines) — model/enum inventory, then full
  reads of `Lead`, `Campaign`, `LeadStatus`.
- Verified F-2 by grepping every `migrations/**/migration.sql` for `LeadStatus` (no hits;
  only the unrelated `InsuranceLeadStatus`).
- Verified F-9 by grepping `apps/` and `packages/` for writers of `dialer:active_calls`
  (none).
- Verified F-1's enum absence by grepping `DIALING` across all TypeScript sources — the
  only hits are the Hopper itself, the Autodialer's workaround comment, and unrelated UI
  copy in `apps/web/src/app/music-console/page.tsx:320`.
- Tenancy findings are not re-derived here; `docs/saas/MULTITENANT_GAP_ANALYSIS.md` §1–§6
  already documents them and was spot-checked against `apps/api/src/middleware/auth.ts`.

### Not audited in this pass

FreeSWITCH dialplan XML, the sip.js provider, the Dograh SSO path, the recording pipeline,
and the inbound DID path were not read line-by-line. They are protected surfaces that
Dialer V2 does not modify; Phase 1 event ingestion will require reading the dialplan, and
that read is scheduled there.
