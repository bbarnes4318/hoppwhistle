# EXISTING ROUTE CONTRACTS

> Prompt 0 — Read-only runtime audit. Grounded in current code at commit `130416d`. Documents the API surface that must remain backward-compatible. Route registration is in [`apps/api/src/index.ts`](../../apps/api/src/index.ts) `buildServer()`; the largest handler set is [`apps/api/src/routes/index.ts`](../../apps/api/src/routes/index.ts) (7287 lines). Nothing was changed.

---

## 0. Global request pipeline (order matters)

From `index.ts` `buildServer()`:

1. CORS (`origin:true, credentials:true`) — line 50 (⚠️ allows all origins even in prod)
2. `registerLoggingMiddleware` — line 56
3. `registerSession` (cookie plugin, secret = `JWT_SECRET`) — line 59
4. `registerAuth` — line 63 (**registers `@fastify/jwt` only; installs NO global auth hook** — `auth.ts:307-313`)
5. multipart (100 MB limit) — line 67
6. **Global `onRequest` resolver for `/api/v1/*`** — lines 77-157 (JWT → `?token=` → **`x-demo-tenant-id` ADMIN/OWNER bypass** → API key)
7. `@fastify/rate-limit` (100 req/min; key = `apiKeyId || ip`) — lines 160-177
8. Error handler → `{ error: { code, message, requestId } }` — lines 392-401

**Auth models:**

- Bearer JWT (`request.jwtVerify()`), or `?token=` query JWT.
- API key `x-api-key` (SHA-256 hashed lookup; validates status/expiry/tenant-active) — lines 122-156.
- 🔴 **Demo bypass:** `x-demo-tenant-id` header / `?demoTenantId=` → `request.user = { tenantId, roles:['ADMIN','OWNER'] }`, no verification (see `MULTITENANT_GAP_ANALYSIS.md` §1).
- Per-route `preHandler:[authenticate]` / `requirePermission(...)` where present. `AuthenticatedUser` = `{ tenantId, userId?, email?, apiKeyId?, roles?, scopes?, buyerId?, publisherId? }` (`auth.ts:8-17`).

**Pervasive tenant idiom (must not silently change semantics):** `const tenantId = demoTenantId || user?.tenantId; if (!tenantId) return 401`. Error envelope: `{ error: { code, message } }`.

---

## 1. Registered route groups (all must remain operational)

From `index.ts` registrations (with source file):

| Base surface                                                    | Registrar                                                | File                                |
| --------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------- |
| `/api/v1/numbers*`                                              | `registerNumberRoutes`                                   | `routes/index.ts`                   |
| `/api/v1/campaigns*`                                            | `registerCampaignRoutes`                                 | `routes/index.ts`                   |
| `/api/v1/publishers*`                                           | `registerPublisherRoutes`                                | `routes/index.ts`                   |
| `/api/v1/calls*`                                                | `registerCallRoutes`                                     | `routes/index.ts`                   |
| `/api/v1/flows*`                                                | `registerFlowManagementRoutes`                           | `routes/flows.ts`                   |
| `/api/v1/webhooks/*`                                            | `registerWebhookRoutes`                                  | `routes/index.ts`                   |
| `/api/v1/users*`                                                | `registerUserRoutes`                                     | `routes/index.ts`                   |
| reporting                                                       | `registerReportingRoutes`                                | `routes/index.ts`                   |
| billing                                                         | `registerBillingRoutes`                                  | `routes/index.ts`                   |
| `/admin/api/v1/tenants*`, numbers, carriers, trunks, rate-cards | `registerAdmin*Routes`                                   | `routes/index.ts`                   |
| `/admin/api/v1/tenants/:tenantId/quota*`                        | `registerQuotaRoutes`                                    | `routes/quotas.ts`                  |
| websocket                                                       | `registerWebSocketRoutes`                                | `routes/websocket.ts`               |
| demo events / demo                                              | `registerDemoEventRoutes` / `registerDemoRoutes`         | `routes/demo-events.ts` / `demo.ts` |
| FreeSWITCH mock                                                 | `registerFreeSWITCHMockRoutes`                           | `routes/freeswitch-mock.ts`         |
| `/api/v1/recordings*`                                           | `registerRecordingManagementRoutes`                      | `routes/recordings.ts`              |
| transcripts                                                     | `registerTranscriptRoutes`                               | `routes/transcripts.ts`             |
| admin billing                                                   | `registerAdminBillingRoutes`                             | `routes/admin-billing.ts`           |
| `/api/auth/*`                                                   | `registerAuthRoutes`                                     | `routes/auth.ts`                    |
| compliance                                                      | `registerComplianceRoutes`                               | `routes/compliance.ts`              |
| STIR/SHAKEN                                                     | `registerStirShakenRoutes`                               | `routes/stir-shaken.ts`             |
| recording analysis (+upload)                                    | `registerRecordingAnalysis*Routes`                       | `routes/recording-analysis*.ts`     |
| `/api/v1/agent/*`                                               | `registerAgentPhoneRoutes`                               | `routes/agent-phone.ts`             |
| `/api/v1/call-center/*`                                         | `registerCallCenterRoutes`                               | `routes/call-center.ts`             |
| `/api/v1/bot/*`                                                 | `registerBotRoutes`                                      | `routes/bot.ts`                     |
| retention                                                       | `registerRetentionRoutes`                                | `routes/retention.ts`               |
| buyer billing                                                   | `registerBuyerBillingRoutes`                             | `routes/buyer-billing.ts`           |
| automation (carrier RPA)                                        | `registerAutomationRoutes`                               | `routes/automation.ts`              |
| lead inject                                                     | `registerLeadInjectRoutes`                               | `routes/lead-inject.ts`             |
| payroll                                                         | `registerPayrollRoutes`                                  | `routes/payroll.ts`                 |
| RTB ping/post                                                   | `registerPingRoutes` / `registerPostRoutes`              | `routes/ping.ts` / `post.ts`        |
| prospect intake                                                 | `registerProspectIntakeRoutes`                           | `routes/prospect-intake.ts`         |
| Anveo / BulkVS / Fractel procurement                            | `register*ProcurementRoutes`                             | `routes/*-procurement.ts`           |
| **`/api/v1/aivoice/*`**                                         | `registerAiVoiceRoutes`                                  | `routes/aivoice.ts`                 |
| **`/api/v1/ai-campaigns*` + `/api/v1/webhooks/vapi`**           | `registerAICampaignRoutes` / `registerVapiWebhookRoutes` | `routes/ai-campaigns.ts`            |
| `/api/v1/music-console/*`                                       | `registerMusicVoiceRoutes`                               | `routes/music-console-voice.ts`     |
| SignalWire webhooks                                             | `registerSignalWireWebhookRoutes`                        | `routes/signalwire-webhooks.ts`     |
| `/api/v1/freeswitch/*`, DID routes                              | `registerDidRouteRoutes`                                 | `routes/did-routes.ts`              |
| insurance leads                                                 | `registerInsuranceLeadRoutes`                            | `routes/insurance-leads.ts`         |
| Health `/health`, `/metrics`, `/docs`                           | `registerHealthRoutes` / inline                          | `routes/health.ts`                  |

Also started at boot (not a route): **Fronter Bot socket server** (`fronter-bot.ts` `start()`, index.ts:379) and a startup `repairUuidRouteDestinations()` data-repair (index.ts:386).

---

## 2. Auth contracts (`routes/auth.ts`)

- `GET /api/auth/me` (preHandler `[authenticate]`, `auth.ts:676-751`) →
  ```
  { id, email, firstName, lastName, roles: string[], tenantId, buyerId, publisherId,
    publisherAccessToRecordings: bool, buyerAccessToRecordings: bool,
    position, defaultScript, customScripts }
  ```
  `tenantId` = DB user's tenant. `publisherAccessToRecordings` ← `Publisher.accessToRecordings`; `buyerAccessToRecordings` ← `Buyer.metadata.accessToRecordings`.
- `POST /api/auth/register` — auto-assigns ADMIN/OWNER (`assignDefaultRole`, `auth.ts:128-148`); tenant from `getDefaultTenantId` (host/referer/origin → slug/domain → fallbacks). 🔴 see gap analysis.
- Login/logout/session per `auth.ts`. Non-`/api/v1/*` routes (incl. `/api/auth/*`) are **not** covered by the global `/api/v1/*` hook — they rely on their own preHandlers.

---

## 3. Human dialer contracts (`routes/agent-phone.ts`) — PROTECTED

| Method + Path                                           | Handler   | Contract / notes                                                                                |
| ------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------ |
| `POST /api/v1/agent/call/originate`                     | 263-465   | → `{ callId, callerId, verto:{ endpoint } }`. State-only (no origination). Caller-ID: `callerId |      | OUTBOUND_CALLER_ID                                                                       |          | '12816991120'`; `'ROTATE'` → pool. **No quota check.** |
| `POST /api/v1/agent/call/:callId/answer`                | 471-591   | call→ANSWERED, recording PENDING→RECORDING, `startRecording`. ⚠️ `findUnique` by id, no tenant. |
| `POST /api/v1/agent/call/:callId/hangup`                | 597-759   | ⚠️ unscoped by tenant                                                                           |
| `POST /api/v1/agent/call/:callId/hold`                  | 765-803   | Redis toggle only. ⚠️ unscoped                                                                  |
| `POST /api/v1/agent/call/:callId/mute`                  | 809-820   | acknowledge-only (no ESL)                                                                       |
| `POST /api/v1/agent/call/merge`                         | 826-868   | real FS conference via `freeswitchService.mergeCalls`. ⚠️ no ownership check on SIP IDs         |
| `POST /api/v1/agent/call/:callId/transfer`              | 874-944   | DB metadata only (no SIP REFER). ⚠️ unscoped                                                    |
| `POST /api/v1/agent/call/:callId/dtmf`                  | 950-967   | returns `{sent:true}`, no ESL                                                                   |
| `GET /api/v1/agent/webrtc/credentials`                  | 977-1076  | → `{ username:'<ext>@<tenant>', password: SIP_AGENT_PASSWORD                                    |      | '1234', realm, wsUrl, stunServers, turnServers:[] }`. Extension auto-assigned 1000-1019. |
| `POST /api/v1/agent/call/incoming`                      | 1126-1248 | 🔴 `tenantId = body.tenantId ?? 'demo-tenant'`, no auth; TCPA fail-open                         |
| `GET /api/v1/agent/status` / `PUT /api/v1/agent/status` | 157-208   | Redis `agent:status:<userId>`, statuses `available                                              | away | dnd                                                                                      | offline` |
| `GET /api/v1/agent/lead/lookup`                         | 1309-1336 | tenant-scoped screen-pop                                                                        |
| `GET /api/v1/agent/calls`                               | ~1259     | tenant-scoped history                                                                           |

Related client credential dependency: web `phone-provider.tsx` requires `username`/`password`/`realm` and overrides `wsUrl` to `:7443`/`:8083`.

---

## 4. Call-center + calls contracts

- `GET /api/v1/call-center/customer-lookup?phone=` (`call-center.ts:33-336`) — normalizes to last-10, searches `insuranceLead > lead > prospectIntake > call`, **all tenant-scoped**. → `{ customer, recentCalls, activities, tasks, submissions, duplicates }`.
- `POST /api/v1/calls/disposition` (`routes/index.ts:3770-3928`) — `findFirst({where:{id, tenantId}})` ✅.
- `GET /api/v1/calls` list — `buildCallWhere` (`routes/index.ts:10-175`) always seeds `{ tenantId }`; role-based financial masking in `mapCallRecord` (357-417): PUBLISHER/BUYER/AGENT see redacted revenue/payout/recordings.
- `GET /api/v1/calls/:callId` — tenant-scoped ✅ (`:3362`).
- ⚠️ `POST /api/v1/calls/:callId/recording-status` (`:3502`) and `GET /api/v1/calls/:callId/recording-debug` (`:3599`) — unscoped by tenant.
- `POST /api/v1/calls` (`:3267-3347`) — calls quota checks but **returns a fake placeholder call** (not the production call path).

---

## 5. Numbers & campaigns (`routes/index.ts`)

- `GET /api/v1/numbers` (522) / `POST /api/v1/numbers` (625) — tenant-scoped; POST checks `checkPhoneNumberQuota` **unless demo mode** (`:640`); then provisioning + `syncDidRouteForNumber`. → `{ id, number, status, provider, capabilities, ... }`.
- ⚠️ `GET /api/v1/numbers/:numberId` (715-727) — **hard-coded stub** returning `+15551234567` / tenant `0000...` (dead/demo).
- `PATCH /api/v1/numbers/:numberId` (729) — `findFirst({where:{id, tenantId}})` ✅, audit-logged.
- Campaigns CRUD (881-1573): create/list/get/patch/duplicate/delete + `/publishers`, `/stats`. Ownership verified via `findFirst({where:{id, tenantId}})` ✅. Create validates publisher/flow/callerIdPool belong to tenant. Status enum `ACTIVE|PAUSED|ARCHIVED`. Envelope `{ data, meta }` (list) / object (item).

---

## 6. Recordings (`routes/recordings.ts`) — PROTECTED

- `POST /api/v1/recordings/upload` (24-141) — FS `upload-recording.sh` ingestion (multipart or `url`); optional `x-api-key`. → `RecordingService.uploadRecording`.
- `GET /api/v1/recordings/:id/stream` (512-565) — **tenant + role scoped** (`where:{id, call:{tenantId}}` + `checkRecordingAccess`).
- `GET /api/v1/recordings/:id` and `/:id/url` — same guards; `/url` mints 1h JWT → `.../stream?token=`.
- 🔴 `GET /api/v1/recordings/local-stream/*` (590-629) — **no auth/tenant check** (path-traversal guard only).

---

## 7. Voice-AI contracts

### Canonical AI Voice SSO (`routes/aivoice.ts`) — PROTECTED

- `GET /api/v1/aivoice/session` (44) — auth-gated (401 unless `userId`/`tenantId`). Mints HS256 Dograh JWT (`signDograhToken`, `AIVOICE_JWT_SECRET`); sets cookies `dograh_auth_token` + `dograh_auth_user` on `.hopwhistle.com` (httpOnly, secure, sameSite=lax, 24h). → `{ url: AIVOICE_URL }`. 503 `AIVOICE_NOT_CONFIGURED` if secret unset.

### Legacy Vapi campaigns (`routes/ai-campaigns.ts`) — PROTECTED, dormant

All gated by preHandler requiring `tenantId` (17-21). Envelope `{ data, meta }` / `{ data }` / `{ success:true }`; errors `{ error }`.

| Method + Path                                | Handler | Service fn                                                                           |
| -------------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `POST /api/v1/ai-campaigns`                  | 75      | `createCampaign`                                                                     |
| `GET /api/v1/ai-campaigns`                   | 28      | `listCampaigns`                                                                      |
| `GET /api/v1/ai-campaigns/templates`         | 46      | `listTemplates`                                                                      |
| `GET /api/v1/ai-campaigns/:id`               | 109     | `getCampaign`                                                                        |
| `PATCH /api/v1/ai-campaigns/:id`             | 126     | `updateCampaign`                                                                     |
| `DELETE /api/v1/ai-campaigns/:id`            | 146     | `deleteCampaign`                                                                     |
| `POST /api/v1/ai-campaigns/:id/start`        | 165     | `startCampaign` (status→RUNNING only; **no dialer**)                                 |
| `POST /api/v1/ai-campaigns/:id/pause`        | 180     | `pauseCampaign`                                                                      |
| `GET /api/v1/ai-campaigns/:id/stats`         | 195     | `getCampaignStats`                                                                   |
| `GET/POST /api/v1/ai-campaigns/:id/contacts` | 212/255 | `getContacts`/`uploadContacts`                                                       |
| `GET /api/v1/ai-campaigns/:id/calls`         | 281     | `getCalls`                                                                           |
| `POST /api/v1/webhooks/vapi`                 | 299-319 | `handleVapiWebhook` — **no auth, no signature verify**; always `200 {received:true}` |

**Status enums (do not rename):** `AICampaignStatus = DRAFT|READY|RUNNING|PAUSED|COMPLETED`; `ContactStatus = PENDING|CALLING|COMPLETED|FAILED|SKIPPED|NO_ANSWER`; `AICallStatus = QUEUED|RINGING|IN_PROGRESS|COMPLETED|FAILED|NO_ANSWER|BUSY|VOICEMAIL`.

### Music Console Voice (`routes/music-console-voice.ts`) — PROTECTED

Auth-gated on `tenantId`. `GET/POST/DELETE /api/v1/music-console/voice-agents[/:id]`, `GET/POST /api/v1/music-console/voice-agents/:id/calls` (ownership-checked; proxies Vapi `/call` / `/call/phone`). The POST-calls endpoint is the only legacy path that actually dials (browser-driven).

---

## 8. Quota admin (`routes/quotas.ts`)

All under `/admin/api/v1/tenants/:tenantId/...` with `preHandler:[requirePermission('admin:full')]`. Note: `'admin:full'` is not in the `Permission` union (`rbac.ts:7-54`); OWNER (`admin:*`) passes, a plain ADMIN is denied. `tenantId` from URL (platform-admin gated).

---

## 9. Contract-stability rules (Master Contract)

Do not rename/remove any existing field, endpoint, env var, table, enum value, or status. The following must stay backward-compatible: `/api/v1/ai-campaigns*`, `/api/v1/webhooks/vapi`, `/api/v1/music-console/*`, `/api/v1/agent/*`, `/api/v1/call-center/*`, `/api/v1/aivoice/session`, login & `/api/auth/me`, call logs & recording playback, existing call/recording rows, existing tenant/user/campaign/phone-number IDs, existing carrier routing (FracTEL). Add new SaaS endpoints under new paths; never repurpose these.
