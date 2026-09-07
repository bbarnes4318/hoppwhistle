# Tenant isolation audit — Phase 1

**Scope:** every route file under `apps/api/src/routes/`, and every Prisma query
reachable from an authenticated request.

**Why now:** NetEnroll sells inbound final-expense calls to licensed agencies,
and two agencies go live on this application at the same time, on one host
(`agents.netenroll.com`), out of one database. An agency must never see another
agency's callers, applications, numbers or money. The boundary is not a feature
of the product; it is the product.

This document lists what was found, what was done about each finding, and what
is deliberately left. It is a record of the Phase 1 pass, not a standing
description of the system — the code and
`apps/api/src/__tests__/tenant-isolation.test.ts` are that.

---

## 1. How the audit was done

A static pass over `apps/api/src/routes/*.ts` extracted every
`prisma.<model>.<op>(...)` call on one of the **54 tenant-scoped models** (models
carrying a `tenantId` column) and flagged those whose call arguments contained no
`tenantId`. That produced **139 candidate call sites**, which were then read and
classified by hand:

| Classification | Count | Meaning |
| --- | ---: | --- |
| `SCOPED_WHERE_VAR` | 9 | `where` is a variable built as `{ tenantId, … }` earlier in the handler. Safe. |
| `SELF_LOOKUP` | 14 | `User.findUnique({ where: { id: user.userId } })` — the id came from the verified JWT. Safe. |
| `GUARDED_BY_PRIOR_FETCH` | 41 | An earlier query in the same handler fetched the row `{ id, tenantId }` and 404'd on a miss. Safe. |
| `POST_CHECK` | 11 | The row is fetched by id, then `row.tenantId !== user.tenantId` is compared. Safe. |
| **Genuinely unscoped** | **20** | Fixed. Listed in §3. |
| Not a tenant question | 44 | `ApiKey.findUnique({ where: { keyHash } })` and similar — these *are* the tenant derivation, not a violation of it. |

Separately, three whole-file patterns were found that no per-query check would
have caught. They are §2, and they were the larger problem.

The script that produced the candidate list is not checked in; it is a
throwaway. The durable check is the integration suite (§5), which asserts the
outcome rather than the shape of the code.

---

## 2. The three systemic findings

### 2.1 `auth.ts getDefaultTenantId()` — registration guessed the tenant

`apps/api/src/routes/auth.ts:28-120` answered "which tenant does this new
account belong to?" in nine steps:

1. `Host` header matched against `tenants.domain`
2. `Referer` header's hostname, **overriding** step 1
3. `Origin` header's hostname, **overriding** both
4. the first host label matched against `tenants.slug`
5. the tenant with slug `test-org`
6. the tenant with slug `default`
7. **the oldest `ACTIVE` tenant row in the table**
8. the oldest tenant row of any status
9. failing all of that, `CREATE` a tenant

Steps 1–4 are chosen by whoever sent the request. Steps 5–8 are chosen by row
order. With two agencies on one host, step 7 is the one that fires — so every
self-serve signup landed inside whichever agency was created first.

The same file also created every registration `PENDING` and returned 202 with no
token (`auth.ts:311`), so a customer who had genuinely paid also had no way in.

**Fixed.** Registration no longer accepts a tenant from anywhere. It accepts a
single-use activation token, and the token carries the tenant:

- new model `TenantActivationGrant` (migration
  `20260906000000_add_tenant_activation_grants`) — SHA-256 of the token only,
  bound to one email address, single-use, time-boxed, with a unique
  `stripeSessionId` so a redelivered Stripe webhook mints no second grant;
- `apps/api/src/services/tenant-activation.ts` issues and redeems them;
- `POST /api/auth/register` and the new-account branch of `POST /api/auth/google`
  require one, and create the user **ACTIVE** — the grant *is* the approval,
  which closes the "no way to self-activate" half as well;
- `POST /api/v1/auth/activation-grants` lets an agency OWNER/ADMIN invite into
  **their own** agency. There is deliberately no `tenantId` field in that body.
- `Referer` and `Origin` are gone from the codebase as tenant hints.

The Stripe-verified path calls `issueActivationGrant({ source: 'STRIPE_CHECKOUT',
stripeSessionId })` once a Checkout session is verified. That verification lands
with the billing phase, on `apps/worker/src/services/stripe-service.ts` — no
second Stripe integration.

### 2.2 `X-Demo-Tenant-Id` was read at ~90 call sites

Handlers resolved the tenant as `demoTenantId || user?.tenantId`, inline, in
about sixty places in `routes/index.ts` alone and in local `getTenantId()` copies
in `retention.ts`, `insurance-leads.ts`, `prospect-intake.ts` and
`call-center.ts`. A header on an otherwise legitimate authenticated request
selected the agency whose data came back.

The global hook already deleted that header when `ALLOW_DEMO_TENANT_AUTH` was
off — but only for `/api/v1/*`, after an early `return` that skipped every other
prefix (`/api/automation/*`, `/api/bot/*`, the retention and call-center
handlers).

**Fixed.**

- `apps/api/src/lib/tenant-context.ts` is now the single place the acting tenant
  is decided. It reads `request.user.tenantId` and nothing else — no header, no
  hostname, no path, no query, no body.
- All ~90 inline reads were replaced with `getActingTenantId(request)` /
  `resolveTenant(request, reply)`.
- The header/query strip in `middleware/api-v1-auth.ts` moved **above** the
  `/api/v1/` gate, so it now applies to every request.
- `AnalyticsFilters.demoTenantId` is deleted. `analytics.ts:56` read
  `filters.demoTenantId || filters.tenantId`, and the reporting routes filled it
  straight from the header.

### 2.3 Falling back to the literal tenant `'default'`

Fourteen handlers resolved the tenant as `user?.tenantId || 'default'` and then
ran the query. An anonymous request was served as a tenant whose id is the string
`"default"` — reads returned nothing, writes landed nowhere, and neither the
caller nor the log said the request had no tenant at all.

Affected: `index.ts` (`/reporting/metrics`, `/reporting/calls`,
`/reporting/campaigns/:campaignId`, `/dashboard/stats`), `stir-shaken.ts` (5),
`compliance.ts` (4), `flows.ts` (1).

**Fixed.** All fourteen now `resolveTenant()` and return 401.

The four remaining `|| 'default'` occurrences in `auth.ts` are `auditLog({
tenantId })` labels on login/logout rows, not query filters. They are
pre-existing and out of this change's scope; note that `audit_logs.tenantId` is
a foreign key, so those rows silently fail to write — worth a follow-up.

---

## 3. Per-query findings and fixes

### Fixed — read or write of a tenant-scoped model with no tenant filter

| File | Route / function | What it did | Fix |
| --- | --- | --- | --- |
| `agent-phone.ts:92` | `getUser()` | Returned `{ userId: 'demo-agent', tenantId: 'default-tenant-id' }` for an unauthenticated request — an invented principal on the softphone surface. | Replaced with `requireAgent()`, which 401s. |
| `agent-phone.ts` ×4 | `call/:callId/{answer,hangup,transfer,screenpop}` | `call.findUnique({ where: { id: callId } })` — any call on the platform. | `findFirst({ where: { id: callId, tenantId } })`. |
| `agent-phone.ts` ×3 | same | `call.update({ where: { id: callId } })` — wrote to any call. | `updateMany({ where: { id: callId, tenantId } })`. |
| `agent-phone.ts:1037` | `webrtc/credentials` | `user.findMany({ select: { metadata: true } })` — **every user row on the platform**, to pick a free extension. | Scoped to `{ tenantId }`. |
| `agent-phone.ts:1081` | same | `phoneNumber.findMany({ where: { userId, status } })`. | Added `tenantId`. |
| `agent-phone.ts:28` | `shouldRecordCall()` | Campaign looked up by id alone, deciding whether *this* agency's call is recorded. | Takes `tenantId`, uses `findFirst`. |
| `agent-phone.ts:294` | `call/originate` | On a missing/expired token, took `callerId` **from the request body**, found the PhoneNumber ending in those digits, and adopted that number's owner as the acting user and tenant. Caller IDs are not secret. | Removed. An expired session is a session to renew. |
| `index.ts:3517,3590` | `POST /calls/:callId/recording-status` | No tenant at all: fetched and wrote any Call by primary key, to any caller (the `/api/v1` hook populates `request.user` but never refuses). | `resolveTenant()` + tenant on both queries. |
| `index.ts:3614` | `GET /calls/:callId/recording-debug` | Same, on the read side — returned metadata and recording rows. | `resolveTenant()` + tenant on the query. |
| `index.ts:2852` | `GET /publishers/:id/rtb-credentials` | `publisher.findUnique({ where: { id } })`, gated only by `requirePublisherAccess()`, which returns `true` for **any** publisherId once the caller holds ADMIN or OWNER and never compares tenants. | `findFirst({ where: { id, tenantId } })`. |
| `index.ts:5207,5215,5258,5321` | reporting + dashboard | `|| 'default'`, see §2.3. | `resolveTenant()`. |
| `index.ts:644` | `POST /numbers` | Skipped the quota check when the demo **header** was present. | Decided by `isDemoTenantAuthEnabled()` instead. |
| `admin-billing.ts` ×6 | all of `/api/v1/admin/billing/*` | Every route took `billingAccountId` from the request and ran raw SQL against it with no ownership check. An owner of one agency could read another's rate cards, close their billing period, pull their invoice PDF and **send a Stripe Connect payout against their account**. | New `requireOwnBillingAccount()` guard; `rate-cards` list joins `billing_accounts` on tenant; invoice PDF joins through its billing account. |
| `admin-billing.ts:281` | preHandler | `if (demoTenantId) return;` — the header skipped the ADMIN/OWNER check outright, on the invoice and payout surface. | Gated on `isDemoTenantAuthEnabled()`. |
| `quotas.ts:482` | `DELETE /admin/…/quota/overrides/:id` | Deleted by override id; a mismatched path deleted another tenant's override while writing an audit row naming this one. | `deleteMany({ where: { id, tenantId } })` + 404. |
| `did-routes.ts:959` | FreeSWITCH CDR webhook | `didRoute.update({ where: { id: body.routeId } })` — `routeId` arrives in an unauthenticated webhook body; anyone reaching the endpoint could inflate another agency's per-route call and duration counters, which they are rated on. | `updateMany` with `tenantId`. |
| `did-routes.ts:981` | same | `phoneNumber.updateMany({ where: { number } })` — released a leased transfer number by E.164 across all agencies. | Added `tenantId`. |
| `post.ts` / `post-service.ts` | `POST /api/v1/post` | Authenticated the publisher by API key, then called `processPost(token)` — the ping named by the token was never checked against the authenticating publisher. Any publisher with a valid key could post another agency's ping token and lease the number it had won. | `processPost(token, publisherId, …)`; ping's `publisherId` compared, answered as `PING_NOT_FOUND`. |
| `post.ts:227` | `GET /internal/route/:e164` | **No auth at all** — returned any DID's routing (buyer, campaign, tenant) to anyone. The two `/internal/` routes beside it had a key check. | Same internal-key/localhost guard. |

### Fixed — the three files the brief called out

**`bot.ts` — authenticated route, no tenant dimension, therefore operator-only.**
Every route is backed by files and a process (`dial.py`, one status file, one
lead file, one recordings directory), not the database. There is no `tenantId`
anywhere and nowhere to put one: the resource is a single platform-wide dialer.
That makes exposing it to an agency a leak in itself — an upload to
`/api/bot/leads/upload` replaces the lead file every other agency is dialed from,
`/api/bot/stop` kills the run they are in, and `/api/bot/recordings/:callId`
serves recordings regardless of owner. It had **no authentication at all**, and
sits outside `/api/v1`, so the hook that populates `request.user` never ran for
it. Now: `authenticate` + `requireRole('ADMIN','OWNER')` as plugin-wide hooks, so
a route added later cannot be added unguarded. `:callId` was also interpolated
straight into a filesystem path (`../` traversal); it is now validated and
resolved against the recordings directory.

**`lead-inject.ts` — one public webhook, three authenticated routes.** The store
and the event emitter were global. `GET /lead-inject/stream` broadcast **every**
injected lead to **every** connected listener — one agency's agents watched
another agency's leads arrive, name, date of birth and all — and `recent` and
`lookup/:phoneNumber` read the same shared store, `lookup` unmasked. All four
answered anonymous callers. Now: store and emitter are keyed by tenant; the POST
is an API-key-authenticated webhook whose tenant is the key's own tenant (the
addressed resource, never a body field); the three read routes take the tenant
from the session. The SSE response also no longer sends
`Access-Control-Allow-Origin: *`, and the consumer's phone number is no longer
logged.

**`post.ts` — public webhook (API key) plus internal routes.** See the table
above.

### Verified safe, no change

- `apps/api/src/routes/retention.ts` — every write is preceded by
  `findFirst({ where: { id, tenantId } })` and 404s on a miss.
- `did-routes.ts` CRUD — same pattern, plus explicit `row.tenantId !== user.tenantId`
  comparisons on referenced buyers, campaigns and publishers.
- `recordings.ts` — scoped through `where: { call: { tenantId } }`.
- `automation.ts` — already gated; its demo fallback is behind
  `isDemoTenantAuthEnabled()` and its jobs are keyed by tenant.
- `ApiKey.findUnique({ where: { keyHash } })` in `ping.ts`, `post.ts`,
  `automation.ts`, `index.ts` — these *are* the tenant derivation for a webhook.
- `User.findUnique({ where: { email } })` in `auth.ts` — email is globally
  unique; the tenant comes from the row, not from the request.

---

## 4. Left deliberately, with reasons

- ~~**`did-routes.ts` FreeSWITCH endpoints** (`/freeswitch/lookup`,
  `/freeswitch/cdr`, call events) are documented `NO AUTH — internal network
  only`. They are public webhooks that derive their tenant from the resource
  being addressed (the DID, and the route row it resolves to), which is the
  correct shape. The residual risk is that "internal network only" is a
  deployment assumption, not an enforced one — they are reachable through nginx
  today. Giving them the shared-secret guard that `post.ts`'s `/internal/` routes
  use is the obvious follow-up; it is a deployment-coordinated change (the
  FreeSWITCH Lua script has to send the header) and did not belong in this
  pass.~~ **Closed in Phase 2c.** All five FreeSWITCH endpoints —
  `/freeswitch/lookup`, `/freeswitch/cdr`, `/freeswitch/recording-uploaded`,
  `/freeswitch/carrier-route` and `/freeswitch/carrier-result` — now carry
  `requireInternalKey`. Both halves of the coordinated change are in the same
  commit: the guard, and the FreeSWITCH side that satisfies it. See §7 below.
- **`requirePublisherAccess()` / `buildPublisherScopedWhere()`**
  (`middleware/rbac.ts:446,459`) return `true` / `{}` for any ADMIN or OWNER
  without consulting the tenant. Every call site reached in this audit now
  carries the tenant on the query instead, which is where it belongs. The helper
  itself is worth tightening so the next call site is safe by default.
- ~~**`bot.ts` is gated on ADMIN/OWNER**, which are per-tenant roles and
  therefore still broader than "NetEnroll platform staff".~~ **Resolved in Phase
  1b.** The capability now exists outside the tenant dimension and `bot.ts` is
  gated on it, along with `quotas.ts`, the `/admin/api/v1/*` console and the demo
  routes. See `docs/PLATFORM_ADMIN.md` for the capability, the audited
  acting-tenant switch, and the verdict for every route examined.
- ~~**`auth.ts` audit rows using `tenantId: 'default'` / `'unknown'`** on
  login/logout are pre-existing.~~ **Fixed.** `audit_logs.tenantId` is now
  nullable, so a genuinely tenant-less event is a real row rather than a fake
  foreign key; `auditLog()` no longer swallows its failures; and all twelve call
  sites that passed a placeholder now pass `null` or a real tenant. The same
  defect on `calls.tenantId` — two TCPA blocked-call records written with
  `tenantId: 'default'`, so every litigator block was recorded nowhere — is fixed
  in `services/blocked-call.ts`, which resolves the agency from the dialled DID.
  See `apps/api/src/__tests__/audit-log.test.ts`.
- **`InsuranceCarrierApplication` has no HTTP list route** yet. It is written by
  the carrier RPA and read through the tenant-keyed automation job endpoints. The
  isolation suite seeds one per agency so that the row exists and the model is
  covered when a read route is added.

---

## 5. Tests

`apps/api/src/__tests__/tenant-isolation.test.ts` — 32 cases, driving a real
Fastify instance with the production auth hook and production route plugins
against a real database. Two agencies are seeded with the **same shape** of data,
so "A's list contains only A's row" is a claim about scoping rather than about
one of them being empty.

- **Lists** — calls, recordings, insurance leads, campaigns, phone numbers,
  publishers, users, buyers (billing), rate cards (billing), reporting metrics:
  asking as A returns A's row and **zero** of B's.
- **Detail by id** — B's call, recording, campaign, lead, publisher credentials,
  recording-debug view and rate cards are 403/404 for A.
- **Writes** — A cannot change B's recording status, campaign or phone number,
  asserted against the database afterwards, not just the status code.
- **Money** — A cannot close B's billing period; asserted by `invoice.count()`
  on B's account.
- **Wire inputs** — `X-Demo-Tenant-Id` and `?demoTenantId=` are ignored on an
  authenticated request; nine list routes answer 401 to an anonymous one.
- **Registration** — refuses without a grant, ignores `Host`/`Referer`/`Origin`,
  never creates a tenant, honours the grant's tenant over a conflicting `Host`,
  refuses a mismatched email, and spends a grant exactly once.
- **Invitations** — an owner's grant lands in their own tenant even when the body
  names another.

It runs in the `forks` pool alongside the other database-backed suites (it
truncates `tenants`), and gates on `TEST_DATABASE_URL` like they do:

```
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/hopwhistle_test pnpm --filter @hopwhistle/api test
```

Full suite at the time of writing: **508 passed, 8 skipped**. Typecheck errors
went from 178 to 146 (none added); lint problems from 1487 to 1413.

---

# Tenant isolation audit — Phase 2: the event bus, Redis and WebSockets

**Scope:** every `eventBus.publish`, every Redis read and write, and every
WebSocket or SSE broadcast reachable from a request, across `apps/api` and
`apps/worker`.

**Why this pass exists.** The Phase 1 audit walked Prisma queries. That made it
structurally blind to anything whose state lives outside Postgres, and Phase 1b
found the proof by hand: `demo-events.ts` took a `tenantId` **from the request
body** and published call events onto the bus for it — the payload an agency's
live board and WebSocket feed render. No per-query check would ever have seen
it, because there is no query.

Phase 2 computes billing inputs from live call state and Phase 3 charges money
against them, so the class of hole matters now rather than later. This is the
systematic pass over that class.

---

## 1. How this pass was done

Three enumerations, each read by hand rather than pattern-matched:

| Surface | How enumerated | Sites |
| --- | --- | ---: |
| Event-bus publishes | `eventBus.publish(` across `apps/api` and `apps/worker` | 20 |
| Redis reads and writes | every module importing `getRedisClient` | 16 files |
| Broadcast to a client | `@fastify/websocket` routes, `text/event-stream` responses | 3 |

For each, two questions: **where does the tenant come from**, and **can a caller
influence it?** A key that carries no tenant is not automatically a finding —
`call:<uuid>` cannot collide — but a key a caller names, holding one agency's
data, always is.

---

## 2. Findings and fixes

### 2.1 `routes/websocket.ts` — the live feed authenticated against an environment variable

`/ws/events` is the socket an agency's live board subscribes to. It decided who
was on the other end like this:

```ts
const validApiKeys = (process.env.VALID_API_KEYS || '').split(',').filter(Boolean);
if (validApiKeys.length > 0 && !validApiKeys.includes(apiKey)) return null;
return { tenantId: process.env.DEFAULT_TENANT_ID || '00000000-…-000000000000' };
```

Three problems, and the third is the one that matters.

1. **The check does not run.** `VALID_API_KEYS` is unset, so `validApiKeys` is
   empty, so `validApiKeys.length > 0` is false and the comparison is skipped
   entirely. Any non-empty string in `?apiKey=` opened a socket.
2. **It has no relationship to the `api_keys` table.** Even with the variable
   set, a key revoked in the product stayed valid here, and a key issued in the
   product was rejected.
3. **The tenant came from configuration, not from the credential.** Every
   subscriber on the platform was handed the same `DEFAULT_TENANT_ID`. The
   delivery filter (`payload.tenantId === tenantId`) then compared each event
   against that one agency — so the feed served whichever agency the environment
   variable happened to name, to anyone who connected, and served the *other*
   agency nothing.

The subscription mechanism was decoration on top of that. A `subscribe` message
recorded its channels in a `Set` that was never read; delivery went out on every
channel to every socket regardless of what had been asked for.

**Fixed.** The credential is verified against the same stores the HTTP surface
uses — an `api_keys` row looked up by SHA-256 hash, with status, expiry and
tenant status all checked, or a JWT verified with the server's own key — and the
tenant comes from that credential. For a person the database decides, including
`PlatformActingTenant` for NetEnroll staff, so a stale tenant in a long-lived
token decides nothing here either. A platform operator in the cross-agency view
gets **no socket**, rather than a socket spanning every agency: a firehose
across agencies is one bug away from showing an agency another agency's callers.

Channels are now authorised **at subscribe time** against an allow-list, refused
by name when they are not on it, and nothing is delivered on a channel the
socket has not been granted. The tenant comparison stays as the boundary; the
grant is what the subscriber asked for. Two conditions, both required.

The welcome frame no longer echoes the tenant id back: the client never supplied
it and does not need it.

### 2.2 `services/event-bus.ts` — one shared connection, unbounded listeners

`subscribePubSub()` kept a single ioredis connection for the whole process and
attached a fresh `pmessage` listener to it on every call, never removing them.
With one WebSocket that is invisible. With several:

- closing the **first** socket ran `punsubscribe('call.*')` on the shared
  connection and silently stopped delivery for every other socket still open;
- listeners for closed sockets stayed attached and accumulated, tripping Node's
  max-listeners warning at eleven connections.

**Fixed.** Listeners are attached once; the handlers live in a `Set`; unsubscribe
removes one handler and only tears down the Redis subscription when the last one
has gone. The handler is still called for every event of every tenant — that is
inherent to a shared pub/sub connection — which is why the comment there says in
so many words that the caller must compare `payload.tenantId` first, and why
`routes/websocket.ts` is the only caller.

### 2.3 `POST /api/v1/agent/call/:callId/hold` — live call state, keyed by call id alone

Live call state lives in Redis at `call:<callId>`, and the call id arrives as a
path parameter. `/hold` read that key and wrote it back with **no tenant check
at all**: an agent of one agency could put another agency's live call on hold,
and the 404-versus-200 answer told them which call ids existed on the platform.

The neighbouring `/screenpop` route had been given a post-hoc comparison in
Phase 1 (it returns a lead's name, number and history); `/hold` had not.

**Fixed.** `CallStateService` gained `getCallStateForTenant()` and
`updateCallStateForTenant()`, which compare the stored `tenantId` against the
acting tenant and answer `null` for a mismatch — the same answer as "no such
call", so the route is not an existence oracle. `/hold`, `/answer`, `/hangup`
and `/screenpop` all go through them, and an update can no longer carry a
`tenantId` that would move a call between agencies. The unguarded methods remain
for the flow engine, which created the state and holds the tenant, and for the
platform-gated demo publisher.

### 2.4 `routes/demo-events.ts` — recorded, fixed in Phase 1b

Took `tenantId` from the request body, unauthenticated, and published call
events onto the bus for it. Fixed in Phase 1b by gating the plugin on the
platform capability; the `tenantId` in the body stays, and is not a Phase 1
violation for the same reason the `:tenantId` in `quotas.ts` is not — it names
the object being administered, and the authority comes from the capability.

Listed here because it is the finding that defined this pass, and because a
reader of this document should be able to see the whole class in one place.

---

## 3. Event-bus publishes — where the tenant comes from

Every publish, and what supplies its `tenantId`.

| Site | Tenant from | Caller-influenced? |
| --- | --- | --- |
| `services/flow-engine.ts` ×9 | `this.tenantId`, set once from the flow's own execution context when the engine is constructed | No |
| `services/recording-service.ts` ×2 | `call.tenantId`, read from the Call row the recording belongs to | No |
| `routes/did-routes.ts` ×2 (FreeSWITCH CDR) | `route.tenantId` on the `DidRoute` row resolved from `body.routeId`, or the RTB route info resolved from the DID | No — the row is the tenant. `body.routeId` names the resource; Phase 1 already scoped the writes beside it |
| `routes/agent-phone.ts` ×8 | `requireAgent(request).tenantId`, i.e. the authenticated principal through the Phase 1 helper | No |
| `routes/demo-events.ts` ×2 | the request body | Yes, and deliberately: platform-capability-gated (§2.4) |

No publish takes its tenant from a header, a query parameter, a hostname, or —
outside the platform-gated demo routes — a request body.

---

## 4. Redis keys — every key, and its tenant dimension

| Key | Written by | Tenant dimension | Verdict |
| --- | --- | --- | --- |
| `call:<callId>` | `services/call-state.ts` | In the value, not the key | **Fixed** (§2.3). The key is collision-free (UUID), but the id arrives from the wire, so access is now compared |
| `agent:status:<userId>` | `routes/agent-phone.ts`, read by `services/routing.ts` | Implicit: a user belongs to exactly one agency, and both sites resolve the user id from within a tenant-scoped query or from the authenticated principal | Safe. A caller cannot name another agency's user id and have it read |
| `live:metrics:v1:<tenantId>:<role>:<scopeId>` | `routes/live-metrics.ts` | **In the key**, from `getActingTenantId()` | Safe |
| `route:did:<e164>` | `services/number-pool-service.ts`, `routes/did-routes.ts` | In the value. The key is a DID, which is globally unique and is the *addressed resource* | Safe — the correct shape for a webhook: the tenant is derived from the thing being addressed |
| `ping:lease:<pingId>`, `ping:result:<requestId>` | `services/number-pool-service.ts`, `services/auction-service.ts` | In the value; keys are server-generated opaque ids | Safe |
| `ping:cap:reserved:<endpointId>` | `services/auction-service.ts` | A buyer endpoint id, itself tenant-owned | Safe |
| `lock:number:<e164>` | `services/number-pool-service.ts` | None, and correctly so: it is a lock over a globally unique DID, and per-tenant locks would not exclude each other | Safe |
| `tcpa:<tenDigit>` | `services/tcpa-validation-service.ts` | None | Safe by nature. The value is a third party's answer about a phone number — federal DNC and litigator status — which is a fact about the number, not about any agency. A per-tenant key would multiply the API bill for identical answers |
| `session:<sessionId>` | `middleware/session.ts` | In the value; the key is a server-generated session id | Safe |
| `rate_limit:<type>:<identifier>:<window>` | `middleware/rate-limit.ts` | Identifier is an API key id or an IP | Safe |
| `events:stream` (+ consumer groups) | `services/event-bus.ts`, both workers | In each entry's payload | Safe. Consumers are server-side; no request reads the stream |

Two workers (`recording-analysis-worker`, `industry-research-worker`) create
consumer groups on `events:stream` and read entries whose tenant is in the
payload written by the publisher. Nothing a caller sends reaches those keys.

---

## 5. Broadcast surfaces

| Surface | Tenant at subscribe time | Verdict |
| --- | --- | --- |
| `routes/websocket.ts` `/ws/events` | Now from the verified credential; channels authorised on subscribe | **Fixed** (§2.1) |
| `routes/lead-inject.ts` `/lead-inject/stream` (SSE) | `resolveTenant(request, reply)`; the store and emitter are keyed by tenant (`lead:<tenantId>`) | Safe — fixed in Phase 1 |
| `routes/automation.ts` `/status/:jobId` (SSE) | `getTenantJob(jobId, tenantId)` compares the job's tenant before the stream opens and 404s on a miss | Safe |

The rule this pass leaves behind: **a subscription is authorised when it is
made, not filtered when it is delivered.** A delivery-time filter is one
refactor away from being dropped, and nothing fails loudly when it is.

---

## 6. Left deliberately, with reasons

- **`agent:status:<userId>` is not tenant-prefixed.** Every reader resolves the
  user id from inside a tenant-scoped query (`routing.ts` builds its map from
  `phoneNumber.findMany({ where: { tenantId } })`) or from the authenticated
  principal (`agent-phone.ts` writes only the caller's own status). Prefixing it
  would be tidier and would change nothing about what is reachable; it would
  also orphan every live key at deploy time, which on a status flag that gates
  call routing is a worse trade than the tidiness is worth.
- **`route:did:<e164>` and the FreeSWITCH endpoints** derive their tenant from
  the DID being addressed, which is correct for a webhook. The residual risk is
  unchanged from Phase 1 §4: "internal network only" is a deployment assumption
  rather than an enforced one, and the shared-secret guard remains the obvious
  follow-up.
- **`aivoice.ts` and `fish.ts`** share one third-party workspace across agencies
  and are gated on "any authenticated user". Flagged in Phase 1b §3 and still
  out of scope; they are not event-bus or Redis surfaces and this pass did not
  widen them.

---

# 7. The FreeSWITCH endpoints — closed

**Scope:** the five `/api/v1/freeswitch/*` endpoints, and every caller of them.

§4 of the Phase 1 pass recorded these as `NO AUTH — internal network only`, and
recorded honestly that this was a deployment assumption rather than an enforced
one: they are reachable through nginx. Phase 1 deferred closing them because
doing so needs a coordinated change to the FreeSWITCH side. This is that change,
both halves in one commit.

## 7.1 What was open

| Endpoint | Called by | What an unauthenticated caller could do |
| --- | --- | --- |
| `GET /freeswitch/lookup` | `inbound_route.lua`, `dialplan/default.xml` | Ask where any DID on the platform routes: the destination, the campaign, the recording policy. A DID enumeration oracle. |
| `POST /freeswitch/cdr` | `inbound_route.lua` | Write a Call row against the tenant of any `routeId`. Phase 1 scoped the *update* by tenant; nothing stopped the row being created. |
| `POST /freeswitch/recording-uploaded` | `upload-recording.sh` | Attach an arbitrary recording URL to a call. |
| `GET /freeswitch/carrier-route` | `dialplan/default.xml`, `dialplan/vapi_outbound.xml` | Read any agency's carrier waterfall, including gateway hostnames, by passing `?tenant=`. |
| `POST /freeswitch/carrier-result` | both dialplans' hangup hooks | **Take a `tenantId` from its own body or query** and write gateway health against it. An unauthenticated cross-agency write: poison another agency's waterfall into failing over away from a working carrier. |

The last one is the same shape as the `demo-events.ts` finding — a `tenantId`
read straight off the wire — and it survived the Phase 2 sweep because that
sweep enumerated the event bus, Redis and WebSockets, and this is an HTTP route
that the Phase 1 route pass had classified as an intentional public webhook.
Three passes, three different blind spots. §8 is about that.

## 7.2 The guard

`apps/api/src/lib/internal-auth.ts`. A shared secret, `FREESWITCH_INTERNAL_KEY`,
compared in constant time, presented either as the `X-Internal-Key` header or as
a `?k=` query parameter.

**Why a shared secret and not something better.** The callers are FreeSWITCH's
`mod_curl`, from a Lua script and from dialplan `${curl(...)}` expressions.
mod_curl can send a URL, a method and a body. It cannot compute an HMAC, hold a
client certificate, or set a request header. A shared secret is the strongest
thing that fits through that pipe.

**Why a query parameter exists at all, and what it costs.** mod_curl's syntax is
`curl <url> [headers|json] [get|head|post [body]] [connect-timeout n] [timeout
n]`, where `headers` means *return* the response headers, not *send* these.
There is no request-header argument in any released version. So the dialplan and
the Lua script pass the secret in the query string, and **FreeSWITCH logs the
URLs it fetches** — the secret is in FreeSWITCH's logs. That is stated rather
than glossed, and it is why:

- it is its **own** secret, used for nothing else, so a log leak costs one
  rotation and reaches nothing but these five read-mostly endpoints;
- the Lua script redacts it from its *own* log lines (mod_curl's it cannot);
- callers that *can* send a header do — `upload-recording.sh` uses real curl;
- the guard reports which transport was used, so the query form can be measured
  and withdrawn once both mod_curl callers move to something that can carry a
  header. That is the follow-up, and it is smaller than this change was.

It is strictly better than what it replaces, which was nothing.

**It fails closed.** No configured secret means every guarded request is
refused. There is deliberately no "unset means open" mode, because that is
exactly the deployment assumption being replaced — a hole that closes only if
somebody remembers. The blast radius of a missing variable is therefore an
outage rather than a leak, so `scripts/deploy.sh` lists
`FREESWITCH_INTERNAL_KEY` among its required secrets and refuses to deploy
without it: a misconfiguration is a refused deploy, not a silent telephony
failure at 3am.

**It does not choose a tenant.** The endpoints still derive their tenant from
the resource being addressed — the DID, the `DidRoute` row — which is the
correct shape for a webhook and is unchanged. The secret proves the *caller* is
FreeSWITCH. Nothing here reads a tenant from the wire, and `carrier-result`'s
body `tenantId` is now behind the guard rather than in front of it.

## 7.3 The FreeSWITCH side

Both halves are in this PR. What has to be deployed together, and in what order,
is in the PR body; the short version is **FreeSWITCH first**, because a caller
sending a header the API does not yet check breaks nothing, while an API
checking a header the caller does not yet send drops every call.

| File | Change |
| --- | --- |
| `apps/freeswitch/scripts/inbound_route.lua` | Reads `FREESWITCH_INTERNAL_KEY` from the environment; appends `&k=` to the lookup and CDR URLs, percent-encoded; redacts it from its own log lines; logs an explicit error if it is unset. |
| `apps/freeswitch/conf/dialplan/default.xml` | `&k=$${internal_key}` on the lookup, carrier-route and carrier-result URLs. |
| `apps/freeswitch/conf/dialplan/vapi_outbound.xml` | Same, on its carrier-route and carrier-result URLs. |
| `apps/freeswitch/conf/vars.xml` | `internal_key` global, from `${FREESWITCH_INTERNAL_KEY}`. |
| `apps/freeswitch/docker-entrypoint.sh` | Substitutes it, and warns loudly when it is unset. Deliberately no default value: a placeholder would produce a config that looks configured and authenticates against nothing. |
| `apps/freeswitch/scripts/upload-recording.sh` | Sends `X-Internal-Key` — it is real curl and can. |
| `infra/docker/docker-compose.dev.yml` | Passes the same value to both the `api` and `freeswitch` services, with no default. |

## 7.4 Tests

`apps/api/src/__tests__/freeswitch-internal-key.test.ts` — 15 cases against a
real Fastify instance and the real preHandler. The header and the query form
both work; a wrong key, a prefix of the key and the key plus a suffix are all
refused; a repeated `?k=` parameter (which parses to an array) is not coerced;
and the response is byte-identical for "wrong secret" and "no secret
configured", so an unauthenticated caller cannot learn when to try again, while
the log line distinguishes them for whoever is looking at the outage.

Two of the fifteen are static and run with no database or services at all: every
`/api/v1/freeswitch/*` registration carries `requireInternalKey`, and the check
finds exactly the five routes it is meant to be checking — so a regex that
matched nothing could not pass by checking nothing.

The one that matters most: **it fails closed with no secret configured.** If
that case ever returns 200 the endpoints are open again and nothing else in the
system would say so.

---

# 8. Completeness: what has been audited, and what has never been looked at

This is not another sweep. It is an inventory, written because the method used
so far has now failed twice in the same way.

- The **Phase 1** audit walked Prisma queries. It could not see `demo-events.ts`,
  which took a `tenantId` from a request body and published call events for it,
  because there is no query there. Phase 1b found that one by hand.
- The **Phase 2** sweep walked the event bus, Redis and WebSockets. It found
  `/ws/events` accepting any string as an API key and taking the subscriber's
  tenant from an environment variable. It could not see
  `/freeswitch/carrier-result`, which took a `tenantId` from its own body with
  no authentication at all, because that is an HTTP route the Phase 1 pass had
  already classified as an intentional public webhook. Phase 2c (§7) found it
  while closing the FreeSWITCH endpoints.

Two passes, two blind spots, both at the seam between what one pass considered
in scope and what the next did. A third pass with a third method would find a
third. So the deliverable here is the **map**, including the parts of it nobody
has walked, so those can be scheduled rather than discovered.

## 8.1 The inventory

**Audited** means somebody enumerated the surface and read every site.
**Examined** means it was looked at in the course of other work and a verdict
recorded, without an exhaustive pass. **Never examined** means what it says.

| Surface | Can it read or write agency-scoped data? | Status | When |
| --- | --- | --- | --- |
| `apps/api` HTTP routes — Prisma queries | Yes | **Audited** — 139 candidate sites read and classified | Phase 1 |
| `apps/api` — tenant resolution (`lib/tenant-context.ts` and its ~90 call sites) | Yes | **Audited**, re-audited when the refusal was split | Phase 1, Phase 2 |
| `apps/api` — event-bus publishes (20 sites) | Yes | **Audited** — §3 | Phase 2 |
| `apps/api` / `apps/worker` — Redis keys (16 modules) | Yes | **Audited** — §4 | Phase 2 |
| `apps/api` — WebSocket `/ws/events` | Yes | **Audited**, rewritten — §2.1 | Phase 2 |
| `apps/api` — SSE (`lead-inject`, `automation`) | Yes | **Audited** — §5 | Phase 1, Phase 2 |
| `apps/api` — the five `/api/v1/freeswitch/*` endpoints | Yes | **Audited**, closed — §7 | Phase 2c |
| `apps/api` — platform-admin capability and the acting-tenant switch | Yes | **Audited** | Phase 1b, Phase 2 |
| `apps/api` — rating: measurement, curve, engine | Yes (it is the billing input) | **Audited** by construction; every query carries a tenant and is tested against two agencies | Phase 2 |
| FreeSWITCH Lua + dialplan callers | They *cause* writes | **Examined** while closing §7. Not audited: nobody has read the dialplan for other API calls | Phase 2c |
| **`apps/worker` — scheduled jobs** | **Yes** | **NEVER EXAMINED** | — |
| **`apps/dialer-v2`** | **Yes** | **NEVER EXAMINED** | — |
| **ClickHouse — reads** | **Yes** | **Examined here only** (see 8.2) | — |
| **ClickHouse — the ETL that writes it** | **Yes** | **NEVER EXAMINED** | — |
| **MinIO / S3 — recordings** | **Yes** | **Examined here only** (see 8.2) | — |
| **`apps/api` — `routes/freeswitch-mock.ts`** | No, but it is an open endpoint | **Examined here only** (see 8.2) | — |
| **`apps/api` — the CLI commands under `src/cli/`** | **Yes** | **NEVER EXAMINED** | — |
| `apps/web` | It renders what the API returns | Not a boundary. The API is the boundary; a web bug shows a user their own data wrongly, not another agency's | — |
| `apps/media`, `apps/monitor`, `apps/avatar-worker` | No — no tenant dimension, no database access found | **Examined here** | — |
| Kamailio, RTPengine | No — SIP signalling and media relay, no agency data | **Examined here** | — |

## 8.2 The ones nothing has audited

Named, not fixed. Fixing them is a scheduled pass, not a paragraph in a rating
change — and doing it badly here would be worse than doing it deliberately
later.

### `apps/worker` scheduled jobs — never examined

Seven services run on a schedule with no request and no authenticated
principal, which means `lib/tenant-context.ts` protects none of them: they
choose their own tenants.

| Service | What it touches |
| --- | --- |
| `billing-worker.ts` | consumes `call.*` from the event bus, rates calls, writes accruals |
| `invoice-generator.ts` | closes billing periods, writes invoices |
| `accrual-ledger.ts` | the accrual ledger |
| `clickhouse-etl.ts` | copies call and event rows into ClickHouse |
| `dialer-worker.ts` / `autodialer.ts` | reserves leads and originates calls |
| `stripe-service.ts` | Stripe; contains no `tenant` reference at all |
| `recording-analysis-worker.ts`, `industry-research-worker.ts` | consume `events:stream` |

They talk to Postgres through raw `pg`, not Prisma, so **the Phase 1 audit could
not have seen them even in principle** — it enumerated `prisma.<model>.<op>`
calls. Raw SQL in a worker is exactly the shape of thing all three passes so far
have been structurally unable to see. This is the largest unexamined surface in
the system and it is the one that writes money.

`stripe-service.ts` having zero occurrences of "tenant" is not evidence of
safety; it is the reason to look.

### `apps/dialer-v2` — never examined

A separate service, its own Postgres pool, its own HTTP listener on its own
port. It has `/health`, `/status/flags`, `/status/ingestion` and a token-gated
`/internal/*`. Nobody has asked whether its lead reservations, agent
assignments and call origination are scoped per agency, or whether its
`/status/*` endpoints report across agencies. It is in the repository, it is
built by CI, and no isolation pass has ever opened it.

### ClickHouse

**Reads** (`services/analytics.ts`) do carry `tenant_id = {tenantId:String}` in
their `WHERE` clauses, and the tables are `ORDER BY (tenant_id, ...)`. That is
the right shape and it is what an examination here found — but nobody has
enumerated every query, and ClickHouse is reached by raw query strings, so the
Phase 1 method would not have seen these either.

**Writes** — `apps/worker/src/services/clickhouse-etl.ts` — nobody has looked at
where the `tenant_id` it inserts comes from. A wrong tenant on an ETL row is a
number attributed to the wrong agency in every report built on it, and unlike a
query it is not recoverable by fixing the read side.

### MinIO / S3

Recording objects are keyed `recordings/YYYY/MM/DD/<callId>.<format>` — **no
tenant prefix**. Like the Redis `call:<id>` key, that is collision-free (the
call id is a UUID) and access is controlled by the API scoping the `Recording`
row before it signs a URL, which Phase 1 verified for `recordings.ts`.

The consequence worth stating: because the bucket has no per-tenant prefix,
there is no key structure to hang a bucket policy on, and anything holding raw
bucket credentials sees every agency's recordings. Today that is the API and the
FreeSWITCH upload script. Nobody has audited what else has those credentials, or
whether the presigned URLs the API issues are scoped and short-lived enough.

### `routes/freeswitch-mock.ts`

Three unauthenticated endpoints — `/api/v1/trunks/auth`,
`/api/v1/numbers/lookup`, `/api/v1/recordings/uploaded` — registered
unconditionally in `index.ts`, not behind a flag. They return hardcoded fixtures
and read no database, so they leak no agency data; `/trunks/auth` answers
`{status: "authenticated", tenantId: "00000000-..."}` to anyone who asks. Harmless
as written, and a mock that answers "authenticated" in production is the sort of
thing that becomes real without anyone re-reading it.

### `apps/api/src/cli/`

Seventeen commands that take a tenant from `argv` or from nothing, and run
against production with whatever `DATABASE_URL` is in the environment.
`platform-admins.ts` was written carefully in Phase 1b; the other sixteen have
never been read with isolation in mind. Two stand out without being audited:
`db:migrate:reset` in `package.json` (`prisma migrate reset`, which drops the
database) sits one typo away from `db:migrate:deploy`, and
`query-db.ts` exists.

## 8.3 What would actually close this

Not a fourth pass with a fourth method. The passes keep missing whatever the
current method cannot express, and the misses have all been at a seam. Two
things would do better:

1. **Audit by surface, not by technology.** The inventory above is the artefact
   that makes that possible: it is a list of places data can move, and each row
   can be walked with whatever method suits it. A row is either walked or it is
   not, and this table says which.
2. **Make the boundary testable rather than reviewable.** The 32-case
   `tenant-isolation.test.ts` is worth more than any of these passes, because it
   asserts the outcome rather than the shape of the code, and it keeps asserting
   it. The workers and dialer-v2 have no equivalent. Extending that suite to
   drive a worker tick and a dialer-v2 request with two agencies seeded would
   catch the class of bug all three passes were structurally blind to.

---

# 9. Phase 3 — the billing surfaces

Phase 3 adds money to the platform: a per-agency credit ledger, an Overrun
ceiling, a delivery gate and a nightly settlement that places off-session ACH
debits. This section records what that added to the boundary and how each
addition was scoped. The mechanics are in `docs/BILLING.md`; this is the
isolation reading of them.

**Nothing in Phase 1, 1b or 2 was relaxed.** `lib/tenant-context.ts` is
byte-identical. No new way to find a tenant was introduced, and no route below
reads a tenant from a header, a query parameter or a body.

## 9.1 New tables, and their tenant dimension

| Table | Tenant dimension |
| --- | --- |
| `agency_billing_profiles` | `tenantId`, unique. One row per agency |
| `application_credit_ledger` | `tenantId` on every row; the balance is `SUM(quantity)` filtered by it |
| `daily_settlements` | `tenantId`, unique with `deliveryDay` |
| `settlement_payment_attempts` | via `settlementId` → `daily_settlements.tenantId` |
| `delivery_hold_events` | `tenantId` |
| `billing_notifications` | `tenantId` |

Every one carries a foreign key to `tenants` with `ON DELETE CASCADE`, and every
query in `services/billing/` filters on `tenantId`. There is no aggregate
anywhere that sums across tenants: the cross-agency view computes each agency
independently and returns a list of rows, so one agency's number can never be
derived from another's traffic.

## 9.2 New routes

`routes/delivery-billing.ts`. Agency-scoped routes resolve the tenant through
`resolveTenant()` and take **no parameter naming an agency**:

    GET  /api/v1/delivery/today
    GET  /api/v1/delivery/agents
    GET  /api/v1/delivery/me
    GET  /api/v1/delivery/settlements
    GET  /api/v1/delivery/settlements.csv
    GET  /api/v1/delivery/ledger
    GET  /api/v1/delivery/mandate
    POST /api/v1/delivery/mandate/setup-intent
    POST /api/v1/delivery/mandate/confirm

Platform-scoped routes are gated on `requirePlatformAdmin`. The `:tenantId` in
their paths names **the agency being administered**, not the acting tenant of
the caller — the same shape as `quotas.ts`, and authority comes from the
capability rather than from the parameter:

    GET  /api/v1/platform/delivery/overview
    GET  /api/v1/platform/delivery/settlements
    GET  /api/v1/platform/delivery/agencies/:tenantId/terms
    PUT  /api/v1/platform/delivery/agencies/:tenantId/terms
    PUT  /api/v1/platform/delivery/agencies/:tenantId/ceiling
    POST /api/v1/platform/delivery/agencies/:tenantId/suspend
    POST /api/v1/platform/delivery/agencies/:tenantId/resume
    POST /api/v1/platform/delivery/agencies/:tenantId/opening-purchase
    POST /api/v1/platform/delivery/settlement/run
    GET  /api/v1/platform/delivery/agencies/:tenantId/enrolment
    POST /api/v1/platform/delivery/agencies/:tenantId/enrol
    POST /api/v1/platform/delivery/agencies/:tenantId/unenrol
    PUT  /api/v1/platform/delivery/agencies/:tenantId/charges

The last four are the enrolment and charging switches (`docs/BILLING.md` §0).
They decide whether an agency is billed at all and whether money leaves its bank
account, so they are the most consequential routes on this surface and are
platform-only for the same reason the ceiling override is: an agency must not be
able to change what it can be charged, in either direction.

`settlement.test.ts` asserts an agency OWNER is refused the cross-agency view,
the settlement run and its own ceiling override, and that one agency's
settlement list never contains another's rows.

## 9.3 The one place a browser names a Stripe object

`POST /api/v1/delivery/mandate/confirm` takes a SetupIntent id from the request.
That is the shape of the Stripe flow — the browser completes the SetupIntent and
tells the server which one — and it is the sort of parameter this audit exists
to be suspicious of, so:

- **Nothing in the body is believed.** The payment method, the bank, the last
  four and whether the mandate is usable at all are read back from Stripe by the
  server.
- **The SetupIntent's customer is compared to the agency's own** before anything
  is written, so an agency that guessed or obtained another agency's SetupIntent
  id gets 403 rather than that agency's bank account attached to its profile.
- The route resolves its own tenant through the Phase 1 helper; the body carries
  no tenant and there is no field for one.

## 9.3b Enrolment does not widen anything

The enrolment switch decides whether the billing system applies to an agency. It
changes no tenant resolution: `billingEnrolledAt` lives on
`agency_billing_profiles`, which is keyed on `tenantId`, and the gate reads it
for the tenant it already resolved. An unenrolled agency is short-circuited to
"not gated" **before** any billing state is read, so the enrolment check cannot
become a path that reads another agency's rows.

The one thing worth stating plainly: an unenrolled agency's calls are delivered
without consulting a balance, which is the pre-Phase-3 behaviour and is the
point. It is not a bypass of an isolation boundary — nothing about which agency
a call belongs to changes.

## 9.4 Delivery gating and the machine callbacks

`GET /api/v1/freeswitch/lookup` and `POST /api/v1/agent/call/incoming` now ask
the delivery gate. Neither gained a tenant input: the lookup takes its tenant
from the `DidRoute` row or the Redis lease exactly as before, and the gate is
asked about that tenant. `POST /api/v1/agent/call/incoming` still reads
`body.tenantId`, which §4 of this document already records as a machine-callback
surface out of scope for these passes — the gate does not widen it, and can only
ever refuse more.

`delivery-gating-paths.test.ts` pins that the Phase 1b internal-key guard still
runs **before** the gate on the FreeSWITCH lookup: gating delivery must not have
opened those callbacks to anyone who can reach nginx.

## 9.5 Cross-app import

`apps/api` now imports `apps/worker`'s Stripe service through the
`@hopwhistle/worker/stripe-service` workspace export, so the platform keeps one
Stripe integration rather than two. It is a code import, not a data path: the
module is handed every value it uses, opens no connection pool in the API
process, and reads no tenant of its own.

## 9.6 What this does not close

`apps/worker`'s scheduled jobs and `apps/dialer-v2` are still unaudited (§8.2),
and Phase 3 does not change that. The settlement runs in `apps/api`, through
Prisma, with a `tenantId` on every query — it is not one of the raw-SQL worker
jobs this document flags. `services/billing/notifications.ts` sends email to an
agency's own OWNER and ADMIN users and to holders of the platform capability;
those two recipient lists are built from `tenantId` and from `platform_admins`
respectively, and never merged into one message that would tell an agency about
another.
