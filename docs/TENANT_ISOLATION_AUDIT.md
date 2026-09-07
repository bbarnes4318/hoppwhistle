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

- **`did-routes.ts` FreeSWITCH endpoints** (`/freeswitch/lookup`,
  `/freeswitch/cdr`, call events) are documented `NO AUTH — internal network
  only`. They are public webhooks that derive their tenant from the resource
  being addressed (the DID, and the route row it resolves to), which is the
  correct shape. The residual risk is that "internal network only" is a
  deployment assumption, not an enforced one — they are reachable through nginx
  today. Giving them the shared-secret guard that `post.ts`'s `/internal/` routes
  use is the obvious follow-up; it is a deployment-coordinated change (the
  FreeSWITCH Lua script has to send the header) and did not belong in this pass.
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
