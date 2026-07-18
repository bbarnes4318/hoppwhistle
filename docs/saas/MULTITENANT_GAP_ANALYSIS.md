# MULTITENANT GAP ANALYSIS

> Prompt 0 — Read-only runtime audit. Grounded in current code at commit `130416d`. This document identifies where the current system is NOT safely multi-tenant, feeding the SaaS control-plane / tenant-factory / dialer-v2 roadmap. Findings are cited to exact `file:line`. Nothing here was changed.

**Severity legend:** 🔴 critical (cross-tenant authz/data) · 🟠 high (isolation/enforcement) · 🟡 medium (correctness/robustness).

---

## 0. Executive summary

The platform is _schema-ready_ for multi-tenancy (most models carry `tenantId`) but _not enforcement-ready_. Three structural problems dominate:

1. 🔴 **A browser-supplied header authenticates as ADMIN/OWNER of any tenant** (`x-demo-tenant-id`), across the entire `/api/v1/*` surface — bypassing auth, RBAC, ownership, and quotas simultaneously.
2. 🔴 **No default-deny auth.** `registerAuth` only registers the JWT plugin; there is no global authentication hook. Routes without an explicit `preHandler` are reachable with whatever `request.user` the ad-hoc hook set (or `undefined`).
3. 🟠 **Enforcement layers exist but are disconnected:** the quota middleware is dead code, `recordCallCost` is never called in production (budgets never move), and the `FeatureFlag` table has no evaluator.

---

## 1. 🔴 Browser-trusted tenant identity

### 1a. The demo-tenant hook — root cause

[`apps/api/src/index.ts:106-117`](../../apps/api/src/index.ts): the global `onRequest` hook, for any `/api/v1/*` request where JWT is absent/invalid, reads `x-demo-tenant-id` header **or** `?demoTenantId=` query and sets:

```js
request.user = { tenantId: <attacker-supplied>, roles: ['ADMIN','OWNER'] }
```

with **zero verification**. This single header simultaneously (a) authenticates, (b) grants ADMIN+OWNER, (c) sets tenant scope, and (d) skips quota (via the `if (!demoTenantId)` idiom). It is gated only to URLs starting `/api/v1/` — which is essentially the entire product API. It is also honored by the admin-billing preHandler (`admin-billing.ts:264-267` returns early if `demoTenantId` present).

**Blast radius:** full cross-tenant read/write as ADMIN/OWNER of any tenant id. This is the #1 blocker for `saas_control_plane_v1` / `tenant_factory_v1`.

### 1b. The `demoTenantId ||` idiom (pervasive)

`const tenantId = demoTenantId || user?.tenantId` where `demoTenantId = request.headers['x-demo-tenant-id']` — **116 occurrences in [`routes/index.ts`](../../apps/api/src/routes/index.ts) alone** (e.g. `:527-527`, `:628-629`, `:887-888`, `:3351-3352`); ~199 across 16 files. The header always **overrides** the authenticated tenant.

### 1c. Body/header-supplied tenant

| Location                   | Issue                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-phone.ts:1130`      | `POST /api/v1/agent/call/incoming`: `const tenantId = body.tenantId ?? 'demo-tenant'` — fully body-supplied, route unauthenticated                      |
| `agent-phone.ts:92-95`     | `getUser()` returns `{ userId:'demo-agent', tenantId:'default-tenant-id' }` when unauthenticated (used at `:174,215,266,475,615,769,879,980,1259,1310`) |
| `auth.ts:31-54`            | `getDefaultTenantId()` resolves tenant from client `Host`/`Referer`/`Origin` headers at login/register                                                  |
| `admin-billing.ts:264-267` | admin auth skipped if `x-demo-tenant-id` present                                                                                                        |

### 1d. Public register grants ADMIN

`auth.ts:128-148` (`assignDefaultRole`): every self-registered user via `/api/auth/register` is auto-assigned **ADMIN** (or OWNER), in a tenant chosen from client headers. 🔴

**Remediation direction (net-new, flagged):** introduce authenticated tenant context as the _only_ source of `tenantId`; make the demo path a build/env-gated dev-only affordance behind `SAAS_CONTROL_PLANE_ENABLED`=false semantics; add a global default-deny auth hook. Never trust `x-demo-tenant-id`/`body.tenantId` when authenticated context exists (Master Contract DB rule).

---

## 2. 🔴 Child-resource ownership not verified

Handlers that look up a tenant-owned entity by `id` with **no `tenantId` filter** (any authenticated tenant can read/mutate another tenant's resource):

| Endpoint / call                               | File:line                                                | Resource                                                                                      |
| --------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /api/v1/calls/:callId/recording-status` | `routes/index.ts:3502-3504`                              | `call.findUnique({where:{id}})` then mutates                                                  |
| `GET /api/v1/calls/:callId/recording-debug`   | `routes/index.ts:3599-3604`                              | unscoped call + recordings read                                                               |
| answer / hangup / transfer / screenpop        | `agent-phone.ts:479-480, 619-620, 890-891, 1103-1104`    | `call.findUnique({where:{id}})` — tenant not applied                                          |
| hold                                          | `agent-phone.ts:771`                                     | `callStateService.getCallState(callId)` — no tenant check                                     |
| merge                                         | `agent-phone.ts:826-868`                                 | arbitrary SIP call IDs → FS conference, no ownership check                                    |
| campaign lookup                               | `agent-phone.ts:28-29`                                   | `campaign.findUnique({where:{id}})` unscoped                                                  |
| DID routing                                   | `did-routes.ts:86,92,98,124-125,637-638,665-666,715-716` | buyer/campaign/publisher/phoneNumber/didRoute/call by id, unscoped                            |
| lead list                                     | `insurance-leads.ts:207`                                 | `leadList.findUnique({where:{id}})` unscoped                                                  |
| buyer transactions                            | `buyer-billing-service.ts:449`                           | `getBuyerTransactions(buyerId)` scoped only by buyerId                                        |
| recording `local-stream`                      | `recordings.ts:590-629`                                  | `GET /api/v1/recordings/local-stream/*` — **no auth/tenant check**, path-traversal guard only |

**Correctly scoped (pattern to replicate):** `GET /api/v1/calls/:callId` uses `findFirst({where:{id, tenantId}})` (`routes/index.ts:3362-3366`); `call-center.ts` customer-lookup filters `tenantId` on every query; quota counts always include `tenantId`.

---

## 3. Tenant scoping of data models

`PhoneNumber`, `Campaign`, `Call`, `Publisher`, `Buyer`, `Flow`, `TenantQuota`, `TenantBudget`, `ApiKey`, `AccrualLedger`, `FeatureFlag`, `RecordingAnalysis`, `AICampaign`, `VoiceAgent`, and ~57 models **carry `tenantId`** and are safely scopeable.

**Models WITHOUT a `tenantId` column** (`schema.prisma`):

- **Scoped via parent FK (acceptable if queries always join through the parent):** `UserRole`, `CallerIdPoolPhoneNumber`, `BuyerEndpoint`, `BuyerStats`, `FlowVersion`, `Node`, `Edge`, `CallLeg`, `Recording` (via callId), `Transcription`, `CallTag`, `InvoiceLine`, `Payout`, `DncListEntry`, `LeadCall`, `RetentionNote`, `BuyerBid`, `AICampaignContact`, `AICampaignCall`.
- 🟠 **No tenantId AND accessed by id / holds money or PII:** `BuyerTransaction` (wallet ledger; scoped only by buyerId), `RateCard`, `Invoice` (scoped via billingAccountId only), `Balance`, `PingRequest`, `TimeEntry`, `UserFinancials`, `PayrollPayout`, `VapiTemplate`. `Role` is global by design.
- 🟡 `ProspectIntake.tenantId` has `@default("default-tenant-id")` (`schema.prisma:2136`) — silently absorbs rows with no tenant.

**Direction:** every tenant-owned model must have `tenantId` + tenant indexes and enforce ownership server-side (Master Contract). The parent-FK models need query-time guarantees; the money/PII models in the 🟠 group need `tenantId` added (additive, nullable/backfilled migration).

---

## 4. 🟠 Quota / budget enforcement is disconnected

- **Quota middleware is dead code.** `middleware/quota.ts:11` `requireQuotaCheck` is never imported/attached to any route (sole grep hit is its own definition).
- **`recordCallCost` is never called in production.** Only invoked from `cli/test-quota-overage.ts:141`. So `TenantBudget.currentDaySpend/currentMonthSpend` never increment → `checkBudget` compares against perpetually-zero spend → budget enforcement is **inert** in normal operation.
- **`checkBudget` only blocks when `hardStopEnabled`** (`quota-service.ts:356,386`); otherwise returns allowed even over budget.
- **The real call-completion path** does not call quotas. `POST /api/v1/calls` (which _does_ call `checkConcurrentCalls/checkDailyMinutes/checkBudget`, `routes/index.ts:3283-3317`) is a **placeholder returning a fake call** (`:3332`, id `0000...`), not the production path.
- **Human dialer + Hopper both bypass quotas entirely** (see runtime map). Quotas are enforced only in number provisioning (`routes/index.ts:642`, skipped in demo mode) and `provisioning-service.ts:325`.

**Direction:** `usage_metering_v1` + `subscription_billing_v1` need a real metering hook on call completion (wire `recordCallCost` / buyer-billing into the CDR/`call.ended` event) and a live quota gate on all origination paths, all flag-gated and disabled by default.

---

## 5. 🟠 Feature-flag system has no runtime

`schema.prisma:1539` `FeatureFlag { tenantId, key, value Json, unique[tenantId,key] }` exists and is **seeded** (`seed.ts:427`: `advanced_analytics`, `ai_transcription`, `stir_shaken`) but **never read at runtime** — no service/route/middleware queries `prisma.featureFlag`. There is no evaluator.

**Existing env toggles actually read** (the only working flags today): `ENABLE_TRACING`, `RECORDING_LIFECYCLE_ENABLED`, `FIELD_ENCRYPTION_KEY` (gates encryption), `VAPI_API_KEY/TOKEN`, `FONESTORM_*`, `S3_BUCKET`/`LOCAL_STORAGE_DIR`, `NODE_ENV`, `CSRF_SECRET`, `JWT_SECRET`. Per-tenant DB switches: `TenantQuota.enabled`, `TenantBudget.hardStopEnabled`, `x-quota-override` header + `QuotaOverride`.

**None of the Master-Contract SaaS flags exist yet** (`saas_control_plane_v1`, `tenant_factory_v1`, `white_label_branding_v1`, `custom_domains_v1`, `concurrent_seats_v1`, `byoc_trunks_v1`, `caller_id_policy_v1`, `tenant_dialer_v2`, `tenant_dialer_v2_shadow`, `usage_metering_v1`, `subscription_billing_v1`, `managed_telecom_wallet_v1`, `self_service_onboarding_v1`), and **none of the required env kill switches exist** (`SAAS_CONTROL_PLANE_ENABLED`, `TENANT_DIALER_V2_ENABLED`, `TENANT_DIALER_V2_ORIGINATE_ENABLED`, `TENANT_DIALER_V2_ALLOWED_TENANT_IDS`, `SUBSCRIPTION_BILLING_ENABLED`, `MANAGED_TELECOM_ENABLED`, `CUSTOM_DOMAINS_ENABLED`).

**Direction:** build a tenant-scoped flag evaluator on top of the existing `FeatureFlag` table (additive), default every flag off, and add the env kill switches. This is foundational for `saas_control_plane_v1`.

---

## 6. 🟠 Redis keys not tenant-scoped

| Key                                               | File:line                                         | Risk                                                                                           |
| ------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `dialer:active_calls`                             | `dialer-worker.ts:291`                            | 🟠 Single global concurrency counter — one tenant's volume throttles all tenants               |
| `route:did:${e164}`                               | `number-pool-service.ts:200`, `did-routes.ts:845` | 🟠 Global DID→route map; collision if a DID is reused across tenants                           |
| `tcpa:${tenDigit}`                                | `tcpa-validation-service.ts:68`                   | 🟡 TCPA cache keyed on phone only, shared across tenants                                       |
| `ping:cap:reserved:${endpointId}`                 | `auction-service.ts:448`                          | endpoint-scoped, global namespace                                                              |
| `ping:result:${requestId}`                        | `auction-service.ts:684`                          | request-scoped                                                                                 |
| `lock:number:${number}`                           | `number-pool-service.ts:100`                      | number-allocation lock, global                                                                 |
| `rate_limit:${type}:${identifier}:${windowStart}` | `rate-limit.ts:23`                                | identifier may not encode tenant                                                               |
| `agent:status:${userId}`                          | `agent-phone.ts:98`                               | 🟡 not tenant-prefixed (userId global uniqueness only)                                         |
| `call:${callId}`                                  | `call-state.ts:32`                                | 🟡 `tenantId` inside JSON value but key not prefixed; readers never validate embedded tenantId |
| `session:${sessionId}`                            | `session.ts:47`                                   | ✅ acceptable                                                                                  |
| `events:stream`                                   | billing/recording workers                         | global stream; `tenantId` in payload — consumers must filter                                   |

**Direction:** for white-label isolation, namespace concurrency/routing/compliance keys per tenant (e.g. `tenant:{id}:dialer:active_calls`) so one tenant cannot throttle or collide with another. Additive, behind the dialer-v2 work.

---

## 7. 🔴 Tracked secrets / credential handling

Per the Master Contract (do not store/log carrier, SIP, Vapi credentials unencrypted). Pre-existing violations:

| Location                                                                                         | Type                                            |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `252L-20250710.key` (repo root, git-tracked)                                                     | **STIR/SHAKEN ES256 private key**               |
| `252L-20250710.crt`                                                                              | STIR/SHAKEN cert                                |
| `docker-compose.yml:222-223`, `dev.yml:126-127`                                                  | `BULKVS_USERNAME` / `BULKVS_PASSWORD` plaintext |
| `docker-compose.yml:118,271`, `dev.yml:113`                                                      | `FREESWITCH_ESL_PASSWORD=ClueCon`               |
| `vapi-carrier-service.ts:63`, `directory/default/vapi.xml:6`                                     | FS↔Vapi SIP trunk password `VapiFS_...`        |
| `apps/web/src/app/vapi-proxy/{calls,assistants,assistants/[id]}/route.ts:3`                      | hard-coded Vapi API key `b8c9e4...`             |
| `README_VAPI_INTEGRATION.md`                                                                     | SIP password + Vapi token in plaintext doc      |
| compose `JWT_SECRET` defaults `35353535` / `dev-secret-...`; `SIP_AGENT_PASSWORD` default `1234` | weak/committed                                  |

The runtime `.env` at repo root is **not** git-tracked (good). Remediation must be a dedicated, authorized change (key rotation + history scrub), not folded into a feature PR.

---

## 8. Demo/fallback tenants

`'demo-tenant'` (`agent-phone.ts:1130`), `'default-tenant-id'` (`agent-phone.ts:94`, `ProspectIntake` schema default `:2136`), `'default'`/`test-org`/auto-created "Default Organization" (`auth.ts:83-124`), and the `x-demo-tenant-id` consumers across `routes/index.ts` + `admin-billing.ts`. These must be neutralized (or dev-only gated) before onboarding real external tenants.

---

## 9. Prioritized gap list for the SaaS roadmap

| #   | Gap                                                              | Sev | Blocks                                     |
| --- | ---------------------------------------------------------------- | --- | ------------------------------------------ |
| 1   | `x-demo-tenant-id` ADMIN/OWNER bypass                            | 🔴  | control-plane, tenant-factory              |
| 2   | No default-deny auth hook                                        | 🔴  | all tenant isolation                       |
| 3   | Child-resource ownership not enforced (§2)                       | 🔴  | multi-tenant data safety                   |
| 4   | Public register grants ADMIN + header-chosen tenant              | 🔴  | self-service onboarding                    |
| 5   | Feature-flag table has no evaluator; no SaaS flags/kill switches | 🟠  | every flagged capability                   |
| 6   | Quota middleware dead; budgets inert; dialers bypass quotas      | 🟠  | usage-metering, subscription-billing       |
| 7   | Redis concurrency/routing/compliance keys global                 | 🟠  | concurrent-seats, byoc, dialer-v2          |
| 8   | Money/PII models without `tenantId` (§3)                         | 🟠  | billing isolation                          |
| 9   | Tracked secrets / weak defaults                                  | 🔴  | production security (separate remediation) |
| 10  | No regression coverage on originate/caller-ID/recording/dialer   | 🟠  | safe activation of any dialing feature     |

All remediations must be **additive, feature-flagged, disabled by default, activated for test tenants first**, per the Master Contract.
