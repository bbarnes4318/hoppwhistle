# PROTECTED SYSTEM INVARIANTS

> Prompt 0 — Read-only runtime audit. Grounded in current code at commit `130416d`. This document records the behaviors and files that MUST remain operational and unchanged during SaaS productization, per the Master Engineering Contract. Any SaaS work that would violate an invariant here must STOP and request explicit authorization.

---

## 1. Protected files (do not modify without explicit, narrowly-scoped authorization)

### Voice-AI (Vapi legacy + canonical AI Voice SSO)

| File                                                                   | Why protected                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/api/src/services/ai-campaign-service.ts`                         | Vapi campaign engine + webhook billing (legacy but registered)                     |
| `apps/api/src/routes/ai-campaigns.ts`                                  | `/api/v1/ai-campaigns*` + `/api/v1/webhooks/vapi`                                  |
| `apps/api/src/routes/music-console-voice.ts`                           | Music Console voice dispatch                                                       |
| `apps/api/src/services/fronter-bot.ts`                                 | DTMF fronter socket for the classic dialer                                         |
| `apps/api/prisma/seed-vapi-templates.ts`                               | Vapi template seed                                                                 |
| `apps/web/src/app/(dashboard)/voice-agents/**`                         | **The live AI Voice iframe page** (SSO embed)                                      |
| `apps/web/src/app/music-console/voice/**`                              | Music Console voice UI                                                             |
| **`apps/api/src/routes/aivoice.ts`**                                   | **SSO route minting the Dograh session cookie — breaking it breaks live AI Voice** |
| **`apps/api/src/lib/aivoice-jwt.ts`**                                  | **Dograh JWT signer (HS256, must match Dograh `OSS_JWT_SECRET`)**                  |
| `apps/api/src/index.ts:351-353`                                        | AI Voice route registration                                                        |
| `apps/web/src/components/layout/sidebar.tsx` (the "AI Voice" nav item) | Menu entry → `/voice-agents`                                                       |

### Human dialer

| File                                                       | Why protected                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/routes/agent-phone.ts`                       | Softphone control (originate/answer/hangup/hold/transfer/merge/DTMF, WebRTC credentials, screen-pop, agent status) |
| `apps/api/src/routes/call-center.ts`                       | CRM customer lookup                                                                                                |
| `apps/web/src/components/call-center/CallCenterPortal.tsx` | Agent portal (dialer UI, auto-dial, disposition)                                                                   |
| `apps/web/src/components/call-center/**`                   | Call-center UI (presentation-only changes require explicit authorization)                                          |
| `apps/web/src/components/phone/**`                         | sip.js WebRTC provider (registration, media)                                                                       |
| `apps/api/src/services/call-state.ts`                      | Redis call-state store                                                                                             |
| `apps/api/src/services/freeswitch-service.ts`              | ESL recording + 3-way merge                                                                                        |

### Telephony (staging + approval gate required — see §4)

`apps/freeswitch/**` — all FreeSWITCH config: dialplans (`dialplan/default.xml`, `dialplan/vapi_outbound.xml`, `public.xml`), SIP profiles (`sip_profiles/external/*.xml`), directory (`directory/default/1000-1019.xml`, `vapi.xml`), scripts (`upload-recording.sh`), STIR/SHAKEN keys.

### Legacy workers (build Dialer V2 separately; do not edit in early phases)

`apps/worker/src/services/autodialer.ts` (dead), `apps/worker/src/services/dialer-worker.ts` (**live production dialer — The Hopper**).

### Data & carrier services touched by live routing

`apps/api/src/services/did-route-service.ts`, `number-pool-service.ts`, `carrier-service.ts`, `cnam-service.ts`, `routing.ts`, `recording-service.ts`, `recording-reconciler.ts`, `recording-lifecycle.ts`, `storage.ts`, `billing-service.ts`, `buyer-billing-service.ts`.

> **Working-tree note:** at audit time three protected files had uncommitted local edits (pre-existing, not made by this audit): `apps/api/src/services/did-route-service.ts`, `apps/freeswitch/conf/dialplan/vapi_outbound.xml`, `apps/web/src/components/phone/phone-provider.tsx`. This audit did not touch them.

---

## 2. Contracts that must remain operational & backward-compatible

- `POST /api/v1/agent/call/originate` returns `{ callId, callerId, verto:{ endpoint } }` — the browser depends on `callId` + `callerId`; do not remove the `verto` field even though it is vestigial.
- `GET /api/v1/agent/webrtc/credentials` returns `{ username, password, realm, wsUrl, stunServers, turnServers, ... }` — the sip.js client depends on `username`/`password`/`realm`.
- `GET /api/auth/me` shape (see `EXISTING_ROUTE_CONTRACTS.md` §Auth). Fields consumed by the web app: `roles`, `tenantId`, `publisherAccessToRecordings`, `buyerAccessToRecordings`.
- `/api/v1/ai-campaigns*` response envelope `{ data, meta }` / `{ data }` / `{ success }`; status enums `DRAFT|READY|RUNNING|PAUSED|COMPLETED` — **do not rename or reorder**.
- `POST /api/v1/webhooks/vapi` always returns `200 {received:true}` (errors swallowed to prevent Vapi retries).
- `GET /api/v1/aivoice/session` returns `{ url }` and sets cookies `dograh_auth_token` + `dograh_auth_user` on `.hopwhistle.com`. **The cookie names, domain, and JWT claim set (`sub`,`email`,`iat`,`exp`, HS256) must match the deployed Dograh app** — changing any of them logs users out of AI Voice.
- `/api/v1/agent/*`, `/api/v1/call-center/*`, `/api/v1/music-console/*`, `/api/v1/recordings/:id/stream`, `/api/v1/calls*` — existing shapes must not break.
- Existing tenant IDs, user IDs, campaign IDs, phone-number IDs, and existing call/recording DB rows must remain valid. Existing carrier routing (FracTEL) must remain the default.
- Existing env-var names must not be renamed without maintaining an alias.

---

## 3. Runtime invariants (behaviors that must not regress)

1. **Human calls originate from the browser, not the server.** The API `originate` endpoint must remain state-only; do not "helpfully" add server-side origination to it.
2. **The browser client is sip.js over FS WSS :7443 / WS :8083.** Do not change ports, realm derivation, or the `X-Caller-ID`/`X-Hopwhistle-Call-Id` INVITE headers.
3. **Agent SIP password comes from `SIP_AGENT_PASSWORD`** (fallback `'1234'` in dev) — see the related memory. Do not hard-code.
4. **The Hopper is the single active background dialer**; the Autodialer stays disabled. Any new dialer must be a separate Dialer V2 gated behind `TENANT_DIALER_V2_ENABLED` + `TENANT_DIALER_V2_ORIGINATE_ENABLED` + tenant allowlist (currently no such gate exists — this is net-new).
5. **FracTEL (`fractel1-6`) is the default outbound gateway** and the STIR/SHAKEN signer. Do not repoint default routing.
6. **Recordings are stereo 16 kHz** on the dialplan path (`default.xml:127-128`) — a recent, deliberate fix (`b6363fc`). Do not revert to mono/8k.
7. **Recording playback on `/api/v1/recordings/:id/stream` is tenant + role scoped** — preserve `checkRecordingAccess` and the `call:{ tenantId }` filter.
8. **The Vapi trunk rides FreeSWITCH port 5070/udp**, isolated from agent phones — must stay published (see memory `vapi-freeswitch-hetzner-trunk`).
9. **The AI Voice iframe embed** (`/voice-agents` → `aivoice.hopwhistle.com`) must keep working: SSO cookie on `.hopwhistle.com`, iframe `allow="microphone; autoplay; clipboard-write"`, and `aivoice.hopwhistle.com` must not start sending `X-Frame-Options: DENY` or a CSP `frame-ancestors` that excludes `hopwhistle.com`.

---

## 4. Telephony change-control gate (Master Contract)

No change to live FreeSWITCH gateways, SIP profiles, dialplans, caller-ID headers, STIR/SHAKEN behavior, recording behavior, media ports, or production routing without ALL of:

1. Staging test 2. Exact configuration diff 3. Syntax validation 4. Test call 5. Two-way-audio confirmation 6. Recording confirmation 7. Documented rollback 8. Explicit approval.

---

## 5. Must-pass regression suites (preserve as baseline)

Present and currently the guardrails to keep green:

- `apps/api/src/__tests__/carrier-rpa-isolation.test.ts`, `carrier-rpa-normalization.test.ts`, `carrier-rpa-redaction.test.ts` — carrier automation isolation
- `apps/api/src/__tests__/field-encryption.test.ts` — field encryption
- `apps/api/src/__tests__/automation-routes.test.ts` — automation routes
- `apps/api/src/__tests__/call-center.test.ts` — call-center lookup/masking (NOT dialing)
- `apps/api/src/__tests__/quota.test.ts` — quotas (unit, mocked Prisma)
- `apps/api/src/__tests__/security.test.ts` — privilege-escalation (DB-level, not HTTP)
- `apps/api/src/services/__tests__/*` — billing, auction, RTB, pay-per-call, flow-store, event-bus
- `apps/worker/src/__tests__/*` — rate-card, billing-integration
- `packages/routing-dsl/src/__tests__/*` — parser, executor

### ⚠️ Critical production behaviors with NO regression coverage (add tests before touching)

FreeSWITCH originate; recording upload/playback/reconciliation lifecycle (incl. tenant-scoping and the open `local-stream` endpoint); caller-ID / DID selection; the background dialer (Hopper); voice-AI campaign + Vapi webhook; human dialing itself (only lookup/masking is tested). Given the July 2026 toll-fraud/carrier-disable incident (memory `agent-phone-outbound-carriers`), the untested **originate + caller-ID selection** paths are the highest-risk gap — new SaaS dialing must add regression coverage here first.

---

## 6. Stale documentation (labeled — do not treat as current truth)

| Doc                                                       | Stale claim                                                     | Actual                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DEPLOYMENT.md`, `app.yaml`                               | DigitalOcean App Platform, no Docker, no FreeSWITCH             | Docker Compose (`dev.yml`) on Hetzner                                                                       |
| `DROPLET_DEPLOY.md`                                       | DO Droplet + managed PG, network `data_net`, branch `master`    | Hetzner, self-contained PG container, network `docker_hopwhistle-network`, branch `edit-campaign-buyer-fix` |
| `QUICKSTART.md`, `START_HERE.md`                          | creds `hopwhistle:hopwhistle_dev`, `up -d postgres redis`       | creds `callfabric:callfabric_dev`; base compose has no `postgres` service                                   |
| `HETZNER_MIGRATION_FROM_AWS.md`, other `HETZNER_*`        | in-progress AWS→Hetzner migration                               | migration effectively done; historical                                                                      |
| `apps/freeswitch/README_VAPI_INTEGRATION.md`              | Vapi is the live Voice AI; prints SIP/Vapi secrets in plaintext | Canonical Voice AI is Dograh at `aivoice.hopwhistle.com`; **also leaks secrets**                            |
| `docs/*`, `walkthrough.md`, `RELEASE_READINESS_REPORT.md` | didcentral gateway active; Autodialer active                    | didcentral dead; Autodialer disabled                                                                        |
| `docker-compose.voice.yml` cert paths                     | `107-170-36-116.sslip.io` (DO IP)                               | prod host is Hetzner `hopwhistle.com`                                                                       |

---

## 7. Tracked secrets that must be treated as compromised (rotate; do not log)

See `MULTITENANT_GAP_ANALYSIS.md` §Secrets for the full list. Highlights: the STIR/SHAKEN **private key** `252L-20250710.key` is git-tracked; plaintext `BULKVS_USERNAME/PASSWORD`, `FREESWITCH_ESL_PASSWORD=ClueCon`, Vapi SIP trunk password `VapiFS_...`, and a hard-coded Vapi API key (`b8c9e4...`) in three `vapi-proxy` route files. The Master Contract forbids storing/logging carrier, SIP, and Vapi credentials unencrypted — these are pre-existing violations to remediate in a dedicated, authorized change (not inside a feature PR).
