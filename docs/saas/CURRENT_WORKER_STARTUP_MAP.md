# CURRENT WORKER STARTUP MAP

> Prompt 0 — Read-only runtime audit. Grounded in current code at commit `130416d` (branch `docs/saas-prompt0-audit`, forked from `feat/aivoice-embed`). No production code was modified to produce this document.

This document answers: **which background services actually start, in what order, which dialer originates real calls, and which worker code is dead vs active.**

---

## 1. The worker process entrypoint

**File:** [`apps/worker/src/index.ts`](../../apps/worker/src/index.ts)

Instances are constructed at module load (lines 12–15):

| Instance        | Class                         | Constructed | Started?                                                                             |
| --------------- | ----------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `billingWorker` | `BillingWorker`               | line 12     | ✅ `await billingWorker.start()` (line 53)                                           |
| `clickhouseETL` | `ClickHouseETL`               | line 13     | ✅ `await clickhouseETL.start()` (line 57) — self-disables if `CLICKHOUSE_URL` unset |
| `dialerWorker`  | `DialerWorker` ("The Hopper") | line 14     | ✅ `await dialerWorker.start()` (line 61)                                            |
| `dialer`        | `Autodialer` (legacy)         | line 15     | ❌ **`// await dialer.start();` commented out (line 66)**                            |

**`main()` startup order** (`index.ts:17`):

1. `initTracing('hopwhistle-worker')` (line 20)
2. Metrics HTTP server on `METRICS_PORT` (default **9091**), exposing `/metrics` and `/health` (lines 23–48)
3. `billingWorker.start()` (line 53)
4. `clickhouseETL.start()` (line 57)
5. `dialerWorker.start()` (line 61)

**Disabled with an explicit rationale** (`index.ts:64–65`):

> "Legacy Autodialer is disabled: it double-dialed alongside The Hopper and targeted the retired `didcentral` gateway. Kept for reference only."

`dialer.stop()` is still called in the shutdown `Promise.all` (line 80), but since `start()` was never called this is a no-op.

### ⇒ Answer: Are `Autodialer` and `DialerWorker` both running?

**No.** Only **`DialerWorker` ("The Hopper")** runs. `Autodialer` is constructed but never started. They do **not** run simultaneously in production.

### ⇒ Answer: Which service originates background calls?

**`DialerWorker.originateCall()`** ([`apps/worker/src/services/dialer-worker.ts:352`](../../apps/worker/src/services/dialer-worker.ts)) via an inbound FreeSWITCH ESL `bgapi originate`.

---

## 2. Worker service classification

| File                                               | Status                                 | Notes                                                                                                                                                                        |
| -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/dialer-worker.ts`                        | **ACTIVE**                             | Started (index.ts:61). Originates production calls to FracTEL gateways.                                                                                                      |
| `services/billing-worker.ts`                       | **ACTIVE**                             | Started (index.ts:53). Consumes Redis Stream `events:stream` (consumer group `billing-group`).                                                                               |
| `services/clickhouse-etl.ts`                       | **ACTIVE (conditional)**               | Started (index.ts:57) but early-returns if `CLICKHOUSE_URL` unset (line ~111).                                                                                               |
| `services/accrual-ledger.ts`                       | **ACTIVE**                             | Used by BillingWorker (billing-worker.ts:8,87).                                                                                                                              |
| `services/autodialer.ts`                           | **DEAD**                               | Constructed but `start()` never called. Targets the retired `didcentral` gateway with a hard-coded `DID_POOL`.                                                               |
| `services/recording-analysis-worker.ts`            | **DEAD / not wired**                   | `startRecordingAnalysisWorker` is **never imported or called** in `index.ts`. It appears wired only in the out-of-tree `prompt.txt` spec file, not in the actual entrypoint. |
| `services/redis.ts`                                | **Effectively unused by running code** | `getRedisClient` is referenced only by the (unstarted) recording-analysis-worker. Billing/Dialer workers each construct their own `ioredis` client.                          |
| `services/invoice-generator.ts`                    | **Not run by the worker**              | Service class (puppeteer + Stripe); invoked on-demand from the billing API, not at worker startup.                                                                           |
| `services/billing-worker.ts` → `stripe-service.ts` | ACTIVE (dependency)                    | Stripe integration behind `STRIPE_ENABLED`.                                                                                                                                  |
| `scripts/simulate-calls.ts`                        | **EXPERIMENTAL / test tooling**        | Manual `npm run simulate:calls`; publishes synthetic `call.completed` events to `events:stream` for billing testing.                                                         |

---

## 3. DialerWorker ("The Hopper") runtime behavior

**File:** [`apps/worker/src/services/dialer-worker.ts`](../../apps/worker/src/services/dialer-worker.ts)

- **Lead sourcing = DB polling (not a queue).** `start()` (line 135) opens ESL (line 154) then a `setInterval` runs `runDialerLoop()` every `DIALER_POLL_INTERVAL_MS` (default **1000 ms**, lines 23 / 157–161).
- `fetchLeadsToDial(limit)` (line 322) runs raw SQL: `SELECT ... FROM "leads" l INNER JOIN "campaigns" c ON l."campaignId"=c.id WHERE l.status='NEW' AND c.status='ACTIVE' ORDER BY l."createdAt" ASC LIMIT n` (lines 325–338).
- **Pacing:** `availableSlots = MAX_CONCURRENT_CALLS − activeCalls` (default MAX **10**, line 22 / 256); batch = `min(availableSlots, DIALER_BATCH_SIZE)` (default **50**, line 24). Each lead is marked `DIALING` before firing (line 273); reverted to `NEW` on originate failure (line 279).
- **Originate (direct ESL, `modesl`):** `originateCall(lead)` (line 352) sends via `bgapi` (line 379):
  ```
  originate {ignore_early_media=true,origination_caller_id_number=<callerId>,
  origination_caller_id_name=Hopwhistle,hopwhistle_lead_id=...,hopwhistle_campaign_id=...,
  hopwhistle_tenant_id=...}sofia/gateway/<fractelN>/<+E164> &socket(<host>:<port> async full)
  ```
- **ESL target:** `FREESWITCH_ESL_HOST`/`FREESWITCH_HOST` (default `freeswitch`), port `FREESWITCH_ESL_PORT` (**8021**), password `FREESWITCH_ESL_PASSWORD` (default **`ClueCon`**) — lines 18–21.
- **Gateway:** `FRACTEL_GATEWAYS = ['fractel1'..'fractel6']` round-robined via `getNextGateway()` (lines 30–37). **Not** `didcentral`.
- **Caller-ID:** `getNextCallerId(tenantId)` (line 84) reads DB `PhoneNumber` where `provider='fractel', status='ACTIVE', poolType='POOL'` (60 s cache, `DID_POOL_TTL_MS`), rotating per tenant. Empty pool → hard-coded fallback `FALLBACK_CALLER_ID = OUTBOUND_CALLER_ID || '+18656000124'` (line 40).
- **On answer**, FreeSWITCH connects outbound to the **Fronter Bot** socket (`&socket(SOCKET_LISTENER_HOST:SOCKET_LISTENER_PORT async full)`, line 372) — see §5.

### ⇒ Does the background dialer enforce tenant quotas/budgets?

**No.** `fetchLeadsToDial` filters only on `lead.status='NEW'` + `campaign.status='ACTIVE'`; `originateCall` performs no budget/quota/balance check. The only throttle is the global `MAX_CONCURRENT_CALLS`.

### ⇒ Is there a kill switch gating real background calls?

**No env kill switch exists.** Searched for `DIALER_ENABLED`, `DISABLE_DIALER`, `DRY_RUN`, `SIMULATE`, etc. — none gate `DialerWorker`. The only "off switch" today is source-level (the commented-out `dialer.start()`). Once the worker process runs and ESL is reachable, The Hopper originates real calls whenever `NEW` leads exist on `ACTIVE` campaigns. **This is a required kill switch for `tenant_dialer_v2` per the Master Contract.**

---

## 4. Legacy `Autodialer` (dead) — for reference

**File:** [`apps/worker/src/services/autodialer.ts`](../../apps/worker/src/services/autodialer.ts)

- `loop()` (line 27) would poll every 2000 ms → `processCampaigns()` (line 40) → Prisma `campaign.findMany({status:'ACTIVE'})` + `lead.findMany({status:'NEW', take:5})`.
- Caller-ID: hard-coded 14-entry `DID_POOL` array (lines 65–82), random pick.
- Originate: raw `net.Socket` to `freeswitch:8021` (hard-coded `ClueCon`, lines 8–10), sending `bgapi originate {...}sofia/gateway/didcentral/1<10digits> &transfer(execute-flow XML default)` (line 86).
- **The `didcentral` gateway has no definition** in `apps/freeswitch/conf/sip_profiles/external/` — this path could not complete calls even if re-enabled.

---

## 5. Fronter Bot — note: starts in the API process, not the worker

**File:** [`apps/api/src/services/fronter-bot.ts`](../../apps/api/src/services/fronter-bot.ts) · started at [`apps/api/src/index.ts:379-381`](../../apps/api/src/index.ts)

The Fronter Bot is a raw TCP server (`net.createServer`) on `FRONTER_SOCKET_PORT` (default **8021**), each connection wrapped in a `modesl` `ESLConnection` (line 81) — it expects FreeSWITCH **outbound-socket** connections (FS dials into the bot when a call answers). On `esl::ready` it runs `handleCall` (line 106): reads `hopwhistle_lead_id/campaign_id/tenant_id` → `answer` → play intro → `waitForDTMF` → **press 1** = mark lead `TRANSFERRED` + `transfer <FRONTER_TRANSFER_DEST> XML default` (default `queue-default`); press 9 / timeout / error map to `NOT_INTERESTED` / `NO_RESPONSE` / `FAILED`.

It is the **DTMF fronter for the classic outbound dialer (Hopper)**, independent of the Vapi/AI-Voice paths. **Caveat:** no in-repo FreeSWITCH dialplan directs calls to this socket, and 8021 is FreeSWITCH's conventional inbound-ESL port — the wiring that feeds this bot lives outside the repo or is incomplete.

---

## 6. Redis keys used by worker-side code (all GLOBAL, not tenant-scoped)

| Key                            | File:line                                                                                                                              | Scope                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `dialer:active_calls`          | `dialer-worker.ts:291` (read only)                                                                                                     | **Global** single counter across all tenants. Never written by the worker — falls back to ESL `show calls count` or in-memory counter. |
| `events:stream` (Redis Stream) | billing consumer group `billing-group` (`billing-worker.ts`), recording-analysis consumer group `recording-analysis-group` (unstarted) | **Global** stream; `tenantId` travels inside event payloads.                                                                           |
| `events:stream` publisher      | `scripts/simulate-calls.ts:48,58`                                                                                                      | test-only                                                                                                                              |

No worker key is tenant-namespaced. Tenant isolation relies solely on globally-unique IDs inside row/event payloads. See `MULTITENANT_GAP_ANALYSIS.md` §Redis.

---

## 7. Summary answers (Prompt 0 questions)

- **Which dialing implementation is used in production?** `DialerWorker` (The Hopper).
- **Are Autodialer and DialerWorker both running?** No — only DialerWorker.
- **Which service originates background calls?** `DialerWorker.originateCall()` via ESL to FracTEL.
- **Which worker code is dead/experimental/active?** See §2. Dead: `autodialer.ts`, `recording-analysis-worker.ts` (not wired). Experimental: `scripts/simulate-calls.ts`. Active: dialer-worker, billing-worker, clickhouse-etl, accrual-ledger.
