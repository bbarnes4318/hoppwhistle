# Agent authorization & tenant-isolation audit

**Status:** findings only. No behaviour is changed by this commit.

**Scope.** The complete lifecycle of a newly created agent account: invitation →
activation → `User` row → `tenantId` → role assignment → `UserRole` → token →
authentication middleware → principal hydration → PlatformAdmin resolution →
acting-tenant resolution → RBAC → route authorization → query scoping →
`/api/auth/me` → frontend session state → navigation → route guards → expiry.

**Relationship to the existing audit.** `docs/TENANT_ISOLATION_AUDIT.md` (895
lines, Phases 1–3) is the record of the tenant-boundary work already done, and
it holds up: the systemic holes it names (`getDefaultTenantId()`,
`X-Demo-Tenant-Id` at ~90 sites, the literal `'default'` tenant) are closed in
the code as it stands today. This document does **not** re-litigate that. It
covers what that audit did not: the **role** dimension, the **agent** scope
inside a tenant, the **frontend** authorization surface, and five residual
findings that a `prisma.<model>.<op>` scan was structurally unable to see.

---

## A. Root cause(s)

### A1 — There is no server-side mechanism that turns an AGENT into an ADMIN. The escalation is in the data, not the code.

I traced every path that can produce `ADMIN`/`OWNER`/`PlatformAdmin` on a
principal and none of them can be reached by an ordinary agent:

| Path | Verdict |
| --- | --- |
| JWT role claims | **Cannot escalate.** `routes/auth.ts` signs `{ tenantId, userId, email }` only. `lib/principal.ts#hydratePrincipal` **replaces** `principal.roles` from `UserRole` rows on every authenticated request; it does not merge. A forged or stale `roles` claim is discarded. |
| Registration | **Cannot escalate.** `POST /api/auth/register` requires an activation token; `assignGrantedRole()` uses the role named by the server-minted grant and, if that role row is missing, assigns **no role at all** rather than guessing. |
| Agency invitation | **Cannot escalate.** `POST /api/v1/auth/activation-grants` hard-rejects any role but `AGENT`, and takes the tenant from `resolveTenant()` with no `tenantId` field in the body. |
| `POST /api/v1/users/invite` | Correctly gated: `isAdminOrOwner` required; `OWNER` may only be granted by an `OWNER`. |
| PlatformAdmin | Granted only by `platform:admins --grant` on the host. No HTTP route mints one. |
| Acting-tenant / preview | `applyPlatformContext` only fires for a principal with a `PlatformAdmin` row. |
| Demo-tenant bypass | `ALLOW_DEMO_TENANT_AUTH` is unset in `apps/api/env.example`; the header is stripped globally when off. See F3 for the residual risk. |

**What *is* in the repository is a script that does exactly the reported thing:**

- `scripts/seed-admin-roles.sql` inserts `role-admin` into `user_roles` for
  **every row in `users`** that does not already have it:
  ```sql
  INSERT INTO user_roles (id, "userId", "roleId", "createdAt")
  SELECT 'ur-' || u.id, u.id, 'role-admin', NOW() FROM users u
  WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur."userId" = u.id AND ur."roleId" = 'role-admin');
  ```
  Re-running it after any new account is created makes that account a Company
  Admin. It is referenced by no deploy script, no migration and no CI job — it
  is a hand-run artefact.

- `scripts/demote-user.sql` is the hand-fix for the same problem, for a named
  production address:
  ```sql
  DELETE FROM user_roles WHERE "userId" = (SELECT id FROM users WHERE email = '…')
    AND "roleId" = 'role-admin';
  ```
  It deletes the ADMIN grant and **assigns nothing in its place**, leaving the
  account with **zero roles**.

A user with zero roles lands on the sidebar's catch-all, which renders exactly
one item — Dashboard (`apps/web/src/components/layout/sidebar.tsx:136-137`). That is
the reported end state, precisely.

**So the most probable reconstruction of the production incident is:
`seed-admin-roles.sql` (or an equivalent hand-run grant) made the new account an
ADMIN; somebody later ran `demote-user.sql`, which removed ADMIN and left no
role; the account collapsed to Dashboard-only.** The elapsed ~20 minutes is how
long it took a person to notice and act, not a timer.

This is a reconstruction, not a proof. §E-verify gives the two queries that
settle it in about a minute against production.

### A2 — The AGENT role is defined as a near-administrator.

`apps/api/src/middleware/rbac.ts:127-148`:

```
AGENT: [ 'users:read', 'users:write', 'roles:read',
         'numbers:read', 'numbers:write', 'numbers:delete',
         'campaigns:read', 'campaigns:write', 'campaigns:delete',
         'calls:read', 'calls:write', 'calls:delete',
         'recordings:read', 'recordings:write', 'recordings:delete',
         'billing:read', 'billing:write',
         'reports:read', 'payroll:read', 'payroll:write' ]
```

AGENT holds 20 of the 34 permissions ADMIN holds, including **`users:write`**,
**`numbers:delete`**, **`campaigns:delete`**, **`calls:delete`**,
**`recordings:delete`**, **`billing:write`** and **`payroll:write`**. It is
missing only `users:delete`, `roles:write`, the `api_keys:*` family, the
`flows:*` family, the `webhooks:*` family and `payroll:admin`.

This is not currently exploitable to the full extent of the list, because the
routes that would matter most are gated on something stronger than a
permission — `requireRole('ADMIN','OWNER')` on the payroll admin surface,
`isAdminOrOwner` on `/users/invite`, `requirePlatformAdmin` on the platform
surface. But the permission set is a standing invitation: the first route
written as `preHandler: requirePermission('users:write')` hands every agent on
the platform the ability to administer their colleagues, and the author of that
route will have done nothing wrong. **The table is the defect, independent of
whether a caller exists today.**

### A3 — The frontend has a second, divergent copy of the role model, and AGENT is missing from parts of it.

Three separate client-side role/permission definitions exist, and they disagree
with the server and with each other:

| Location | Definition | Divergence |
| --- | --- | --- |
| `apps/web/src/hooks/useUserRoles.ts:7` | `type RoleName = 'OWNER'\|'ADMIN'\|'ANALYST'\|'PUBLISHER'\|'BUYER'\|'READONLY'` | **`AGENT` is absent.** Every `hasRole`/`hasAnyRole` call through this hook is un-typecheckable for agents; `useScriptAccess` derives an agent's job title by elimination rather than by role. |
| `apps/web/src/hooks/use-auth.tsx:329-331` | `getPermissions()` gives `AGENT` exactly **`['calls:read']`** | Server gives AGENT 20 permissions. The client denies the agent `reports:read`, which the server grants — so `/reports` bounces an agent the API would have served. |
| `apps/web/src/lib/roles.ts:34` | `getRedirectPath()` sends AGENT to `/dashboard` | `use-auth.tsx:369` sends AGENT to `/call-center`. **The login page uses the first; the dashboard page uses the second**, so every agent login is a redirect to `/dashboard` followed immediately by a client-side redirect to `/call-center`. |

This is the "multiple authorization systems" the brief asks about, and it lives
entirely on the client. The server side genuinely has one principal
(`lib/principal.ts`) and one acting tenant (`lib/tenant-context.ts`), and both
hold.

### A4 — The sidebar's catch-all silently swallows two real roles.

`sidebar.tsx:123-138` dispatches on `isPlatformAdmin → hasFullAccess →
isPublisherOnly → isBuyerOnly → isAgentOnly → isReadonlyOnly → catch-all`.

`ANALYST` matches no branch. A role-less user matches no branch. Both get the
one-item Dashboard nav that is indistinguishable from a broken session. And
`ANALYST` is the **default role of `POST /api/v1/users/invite`** when the body
names none (`routes/index.ts:4703`). Any caller of that endpoint that omits
`role` creates a user who can never see more than one nav item.

---

## B. Secondary causes

1. **Login JWTs never expire.** `middleware/auth.ts:388-390` registers
   `@fastify/jwt` with `{ secret }` and no `sign` options, and none of the three
   `reply.jwtSign(...)` sites in `routes/auth.ts` pass `expiresIn`. A login token
   has no `exp` claim and is valid forever. Comments elsewhere in the codebase
   ("a full seven-day session", `session-token.ts:28`) assume a 7-day lifetime
   that is not implemented. Revocation depends entirely on per-request DB
   resolution, which is why `lib/principal.ts` matters as much as it does.
2. **`request.ip` is nginx.** Fastify is constructed without `trustProxy`
   (`apps/api/src/index.ts:44-52`), while nginx proxies everything and sets
   `X-Forwarded-For`/`X-Real-IP`. Consequences: (a) the global rate limit of
   **100 requests/minute is shared by the entire platform**, keyed on
   `127.0.0.1` — one busy call floor will 429 everybody, and a 429 on
   `/api/auth/me` leaves `user === null`, which is a Dashboard-only sidebar or a
   `/login` redirect; (b) every `ipAddress` in `audit_logs` is `127.0.0.1`, so
   the audit trail cannot attribute anything to an actual client.
3. **Frontend authorization is derived, not served.** `use-auth.tsx` recomputes
   a permission table in the browser from the role list. Every future change to
   `ROLE_PERMISSIONS` has to be mirrored by hand. It already has not been.
4. **`RoleGuard` fails open on an unconfigured guard.** `role-guard.tsx:34-46`:
   with no `allowedRoles` and no `allowedPermissions`, `hasRole` and
   `hasPermission` are both `true`, so a guard wrapped around a page with no
   props authorizes everyone including a role-less account.
5. **The agent nav does not match the product requirement.** `AGENT_NAV`
   (`nav-config.ts:360`) has 7 items. The brief names 16. See §K.
6. **`/admin/live` ("Live Board") does not exist.** It is `pending: true` in
   `PLATFORM_NAV` and has no route under `src/app`.

---

## C. Security vulnerabilities discovered

Ordered by severity. None of these is the cause of the reported symptom; all
were found while tracing it.

### C1 — `GET /api/v1/recordings/local-stream/*` has no authentication at all *(cross-tenant, unauthenticated)*

`apps/api/src/routes/recordings.ts:587-625`. The route is registered on the bare
plugin (`registerRecordingManagementRoutes` adds no `onRequest`/`preHandler`
hook), takes no `preHandler`, and its body never reads `request.user`, never
calls `getActingTenantId()`, and never touches the `recordings` or `calls`
table. It resolves the wildcard against `LOCAL_STORAGE_DIR` and streams the
file. Directory traversal *is* handled; authentication is not.

The keys are handed out: `services/storage.ts:197-200` returns
`/api/v1/recordings/local-stream/<storageKey>` from `getSignedUrl()` whenever
the file exists on local disk **or** S3 credentials are absent, and the key
format is `recordings/YYYY/MM/DD/<callId>.<ext>` — **no tenant segment**. So any
key that ever leaves the building (a log line, a browser history entry, a
`Referer`, a shared link, a support ticket) is a permanent credential-free
download of that agency's call audio, from any tenant, by anybody.

*Answers brief question 2.J: yes, recordings can be read cross-tenant.*

### C2 — Seven-day and one-hour bearer tokens are minted into URLs

- `routes/index.ts:367-381` — every call list/detail response embeds a freshly
  signed **7-day** JWT in `?token=` on the recording playback URL.
- `routes/index.ts:3138-3152` — the CSV export mints a **7-day** JWT when the
  request carried none.
- `routes/recordings.ts:481-492` — a **1-hour** JWT in `?token=`.

`middleware/api-v1-auth.ts` accepts `?token=` for the entire `/api/v1` surface,
so each of these is a general-purpose session credential, not a scoped
playback ticket. Query strings are written to nginx's access log, the API's
access log and browser history. `middleware/session-cookie-auth.ts:24-32` documents this
exact reasoning and refuses to do it — and then three other sites do it anyway.

The CSV site additionally signs `roles: ['ADMIN']`. That claim is inert for a
token carrying a `userId` (`hydratePrincipal` overwrites it), but for a token
minted on an **API-key** request `user?.userId` is `undefined`,
`hydratePrincipal` returns early, and the `ADMIN` claim survives into
`getUserProfile()`, which reads `user.roles` directly
(`routes/index.ts:226-233`). That yields a 7-day tenant-wide administrator
token embedded in a URL.

### C3 — `POST /api/v1/users/invite` does not tenant-validate `publisherId`

`routes/index.ts:4757-4766` validates `buyerId` against the acting tenant
explicitly ("Buyer does not belong to your tenant") and then, at line 4838,
writes `publisherId: body.publisherId || null` with **no check at all**. An
agency ADMIN can create a user linked to another agency's `Publisher`. That link
is authoritative: `authorizationFromUser()` puts it on the principal and
`requirePublisherAccess()` / `buildPublisherScopedWhere()` grant that user the
foreign publisher's calls, earnings and payouts.

*Answers brief question 2.E/2.F: yes, a client-supplied id crosses the boundary here.*

### C4 — `leadList.findUnique({ where: { id } })` in the CRM import is not tenant-scoped

`routes/insurance-leads.ts:337`. The sibling lookup four lines above is correctly
`findFirst({ where: { tenantId, name } })`. This one takes `targetListId`
straight from the request body. It is used to read `.name`, and
`targetListId` then flows into the created lead rows — so a caller can attach
leads to another tenant's list.

### C5 — `ALLOW_DEMO_TENANT_AUTH` is a complete authentication bypass, and the client still sends the header

`middleware/api-v1-auth.ts:104-127`: with the flag on, an `X-Demo-Tenant-Id`
header with **no credential of any kind** is answered as
`{ tenantId, roles: ['ADMIN','OWNER'] }` of the named tenant. The flag is
correctly defaulted off and the header is stripped globally when off, and this
is well documented in `lib/demo-auth.ts`.

The residual risk is operational, and the client keeps the powder dry:
`apps/web/src/lib/api.ts:230-239`, `components/call-center/automation-auth.ts`
and `components/recording-analyzer/api.ts` all attach `X-Demo-Tenant-Id` from
`localStorage.demoTenantId`, and `components/demo/demo-toggle.tsx:38-41` writes
`demoTenantId: 'demo-tenant'` into `localStorage` whenever the backend does not
answer. **Verify `ALLOW_DEMO_TENANT_AUTH` is unset on every production host as
part of this work**; there is nothing in the repository that enforces it.

### C6 — No agent-level scope in the CRM

Every route in `routes/insurance-leads.ts` (18 of them) is tenant-scoped and
nothing more. There is no `assignedTo`, `createdById` or `agentId` narrowing
anywhere in the file. Every agent sees every lead in the agency: names, dates of
birth, phone numbers, requested coverage.

By contrast `routes/applications.ts:262-277` does this correctly, and documents
why — the agent's id **overwrites** any `agentId` in the query rather than
validating it. That is the pattern the CRM needs.

### C7 — An agent can act on any call in the tenant

`routes/agent-phone.ts` scopes every handler by `{ id: callId, tenantId }` and
never by the acting agent. `/answer`, `/hangup`, `/hold`, `/transfer` and
`/merge` will operate on a colleague's live call. This may be intentional for a
call floor; it is recorded here because it is not written down anywhere and it
is not what "My calls" implies.

---

## D. Files involved

**Server — authorization core (all read, all sound):**
`apps/api/src/middleware/auth.ts` · `middleware/api-v1-auth.ts` ·
`middleware/rbac.ts` · `middleware/session.ts` ·
`middleware/session-cookie-auth.ts` · `middleware/read-only-preview.ts` ·
`middleware/rate-limit.ts` · `lib/principal.ts` · `lib/tenant-context.ts` ·
`lib/platform-admin.ts` · `lib/platform-context.ts` · `lib/demo-auth.ts`

**Server — lifecycle:** `routes/auth.ts` · `routes/onboarding.ts` ·
`services/tenant-activation.ts` · `routes/index.ts` (`getUserProfile`,
`buildCallWhere`, `/api/v1/users*`) · `routes/platform.ts`

**Server — agent data surface:** `routes/applications.ts` ·
`routes/insurance-leads.ts` · `routes/agent-phone.ts` · `routes/payroll.ts` ·
`routes/recordings.ts` · `routes/delivery-billing.ts` · `routes/quotas.ts` ·
`services/storage.ts` · `services/time-tracking-service.ts`

**Client:** `hooks/use-auth.tsx` · `hooks/useUserRoles.ts` ·
`hooks/use-platform-context.tsx` · `lib/roles.ts` · `lib/api.ts` ·
`lib/session-token.ts` · `components/auth/role-guard.tsx` ·
`components/layout/sidebar.tsx` · `components/layout/nav-config.ts` ·
`app/(dashboard)/layout.tsx` · `app/(dashboard)/dashboard/page.tsx` ·
`app/login/page.tsx`

**Operational artefacts (not wired to anything, and dangerous):**
`scripts/seed-admin-roles.sql` · `scripts/demote-user.sql` ·
`scripts/check-roles.sql` · `scripts/check-roles.js`

---

## E. Current auth flow

```
BROWSER                         API                              DB
───────                         ───                              ──
POST /api/auth/login  ────────► verify bcrypt                ──► users
                                status/tenant ACTIVE checks
                      ◄──────── jwtSign{tenantId,userId,email}
                                   NO exp claim  ◄── (B1)
                                createSession → Redis 24h
localStorage.token = t
hw_session cookie   = t  (Max-Age 7d, not HttpOnly)
router.push(getRedirectPath(roles))   ← lib/roles.ts  (A3)

GET /api/auth/me ─────────────► authenticateJWT
   Bearer t                     ├ user row + status + tenant match
                                ├ authorizationFromUser(row) → roles  ◄── DB, not token
                                ├ loadPlatformContext(userId)         ──► platform_admins
                                └ roles = preview ? [preview] : [own ∪ acting]
                      ◄──────── {roles, tenantId, isPlatformAdmin, previewRole, …}

GET /api/v1/*  ───────────────► onRequest hook (api-v1-auth)
   Bearer t | ?token= | x-api-key   ├ strip x-demo-tenant-id (unless flag)
                                    ├ jwtVerify
                                    ├ hydratePrincipal  → roles REPLACED from DB
                                    └ applyPlatformContext → tenantId REPLACED for staff
                                route preHandler: requirePermission | requireRole |
                                                  requirePlatformAdmin | requireAgencyPrincipal
                                handler: getActingTenantId(request)  ← request.user ONLY
                                query:   where: { tenantId, … }

AuthSessionProvider (root) ──► one /api/auth/me for the whole tree
PlatformContextProvider   ──► one /api/v1/platform/context (3 retries)
Sidebar ──► isPlatformAdmin → hasFullAccess → publisherOnly → buyerOnly
            → agentOnly → readonlyOnly → CATCH-ALL(Dashboard)   ◄── (A4)
```

**Where authorization state can differ between two moments in one session.**
This is the brief's central question, so it is answered exhaustively:

| # | Input | Can it change mid-session? | Effect |
| --- | --- | --- | --- |
| 1 | `UserRole` rows | **Yes — the only one that matters.** Read fresh on every request. | Role added/removed takes effect on the *next request*, with no re-login. |
| 2 | `User.status` | Yes | `!== 'ACTIVE'` → 403 on every route. |
| 3 | `Tenant.status` | Yes | 403 at login; acting-tenant selection dropped for staff. |
| 4 | `PlatformAdmin` row | Yes | Grants/revokes cross-agency capability immediately. |
| 5 | `PlatformActingTenant` row | Yes | Changes `tenantId` and roles for staff only. |
| 6 | `roles` table contents | Yes | A missing role row makes `assignGrantedRole` a no-op. |
| 7 | JWT claims | **No** — no `exp`, and roles are never read from the token. |
| 8 | Redis session | 24h TTL, but nothing authorization-relevant reads it. |
| 9 | `hw_session` cookie | 7d Max-Age; read-only, GET-only, re-resolved server-side. |
| 10 | Rate limiter | **Yes, per minute** — a 429 on `/api/auth/me` presents as a dead session (B2). |
| 11 | `localStorage` | Holds only the token + demo flags. No role is ever read from it. |
| 12 | React state | One `useState` per provider, no TTL, no revalidation, no React Query. |

#### E-verify — the two queries that settle A1 against production

```sql
-- 1. Did this account's roles change after it was created, and when?
SELECT u.email, u."createdAt" AS user_created,
       r.name AS role, ur."createdAt" AS role_granted
FROM users u
LEFT JOIN user_roles ur ON ur."userId" = u.id
LEFT JOIN roles r       ON r.id = ur."roleId"
WHERE u.email = '<the new agent>'
ORDER BY ur."createdAt";
```
A `role_granted` far later than `user_created` means something granted it after
the fact. `role = NULL` means the account has **no roles** — the Dashboard-only
state — and A1 is confirmed.

```sql
-- 2. What did the server actually decide for this account, and when?
SELECT "createdAt", action, resource, success, error
FROM audit_logs
WHERE "userId" = (SELECT id FROM users WHERE email = '<the new agent>')
ORDER BY "createdAt";
```
`auth.register.success` / `auth.login.success` give the session boundaries;
`authorization.denied` rows show the exact moment and permission at which the
account started being refused. If the denials begin ~20 minutes after login and
name `RATE_LIMIT_EXCEEDED` instead, the cause is B2, not A1.

---

## F. Desired auth flow

Three changes to the diagram above. Everything else stays.

1. **The server tells the client what it may do.** `/api/auth/me` gains an
   `effectivePermissions: string[]` computed from the *same* `ROLE_PERMISSIONS`
   table `checkPermission()` uses, plus a `navKey` naming which nav to render.
   `use-auth.tsx#getPermissions` and `useUserRoles.ts#RoleName` are deleted. One
   definition, served, never re-derived.
2. **The catch-all becomes a named state.** A principal whose role set matches
   no nav renders an explicit "your account has no role assigned — contact your
   administrator" screen, not a one-item nav that looks like a broken session.
   `ANALYST` gets its own branch.
3. **Login tokens expire** (`expiresIn: '7d'`, matching what
   `session-token.ts` already claims) and Fastify gets `trustProxy: true` so the
   rate limiter and the audit trail see real clients.

---

## G. Current role matrix (server, `middleware/rbac.ts`)

`✔` granted · `–` not granted

| Permission | OWNER | ADMIN | AGENT | ANALYST | PUBLISHER | BUYER | READONLY |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `admin:*` | ✔ | – | – | – | – | – | – |
| `users:read` | ✔ | ✔ | **✔** | – | – | – | – |
| `users:write` | ✔ | ✔ | **✔** | – | – | – | – |
| `users:delete` | ✔ | ✔ | – | – | – | – | – |
| `roles:read` | ✔ | ✔ | **✔** | – | – | – | – |
| `roles:write` | ✔ | ✔ | – | – | – | – | – |
| `api_keys:*` | ✔ | ✔ | – | – | – | – | – |
| `numbers:read` | ✔ | ✔ | ✔ | ✔ | – | – | ✔ |
| `numbers:write` | ✔ | ✔ | **✔** | – | – | – | – |
| `numbers:delete` | ✔ | ✔ | **✔** | – | – | – | – |
| `campaigns:read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `campaigns:write` | ✔ | ✔ | **✔** | – | ✔ | – | – |
| `campaigns:delete` | ✔ | ✔ | **✔** | – | – | – | – |
| `flows:*` | ✔ | ✔ | – | read | ✔ | – | read |
| `calls:read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `calls:write` | ✔ | ✔ | ✔ | – | – | ✔ | – |
| `calls:delete` | ✔ | ✔ | **✔** | – | – | – | – |
| `recordings:read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `recordings:write` | ✔ | ✔ | **✔** | – | – | – | – |
| `recordings:delete` | ✔ | ✔ | **✔** | – | – | – | – |
| `webhooks:*` | ✔ | ✔ | – | – | – | – | – |
| `billing:read` | ✔ | ✔ | **✔** | – | – | – | – |
| `billing:write` | ✔ | ✔ | **✔** | – | – | – | – |
| `reports:read` | ✔ | ✔ | ✔ | ✔ | – | – | ✔ |
| `payroll:read` | ✔ | ✔ | ✔ | – | – | – | – |
| `payroll:write` | ✔ | ✔ | **✔** | – | – | – | – |
| `payroll:admin` | ✔ | ✔ | – | – | – | – | – |

The 12 bolded AGENT cells are the ones that have no justification in the agent
workflow. I found no route that requires any of them for an agent to do their
job; they appear to be the residue of an earlier phase where agents were the
only non-admin users on the platform.

`PlatformAdmin` is deliberately **not** in this table. `checkPermission()`
short-circuits to `true` for a principal holding the row, bounded by the acting
tenant. That design is correct and should not be touched.

## H. Desired role matrix — AGENT

Derived from the 16 required pages and the endpoints behind them, then
intersected with least privilege.

| Permission | Keep? | Why |
|---|:-:|---|
| `calls:read` | **keep** | Calls page, Live Board, My day. Narrowed to own calls by `buildCallWhere`. |
| `calls:write` | **keep** | Dispositions, notes, transfer. |
| `recordings:read` | **keep** | Playback of their own calls; `checkRecordingAccess` already narrows AGENT to own-number/own-created. |
| `reports:read` | **keep** | Reports and CRM reports. Must be tenant+agent narrowed at the query. |
| `campaigns:read` | **keep** | Campaigns page is read-only for an agent. |
| `numbers:read` | **keep** | Numbers page / caller-ID selection. |
| `payroll:read` | **keep** | My payroll. Already self-scoped by `userId`. |
| `billing:read` | **keep, narrowed** | Billing / Rate / Delivery / Settlements / Quotas are on the required list. Grant read; the *handlers* must decide what an agent sees, not the permission. |
| `users:read` | **keep, narrowed** | Agent rosters render colleague names. Should be reduced to a names-only endpoint rather than `GET /api/v1/users`. |
| `users:write` | **REMOVE** | An agent must never administer another user. |
| `roles:read` | **REMOVE** | Nothing on the agent surface reads the role catalogue. |
| `numbers:write`, `numbers:delete` | **REMOVE** | An agent does not provision or release DIDs. |
| `campaigns:write`, `campaigns:delete` | **REMOVE** | An agent does not author or delete campaigns. |
| `calls:delete` | **REMOVE** | Destroys the billing and compliance record. |
| `recordings:write`, `recordings:delete` | **REMOVE** | Destroys the compliance record. |
| `billing:write` | **REMOVE** | An agent must not move money. |
| `payroll:write` | **REMOVE** | `payroll:write` is the *admin* verb; the self-service time-entry routes gate on `userId`, not on this. |

Invariants that must hold and must be asserted by a test:
`AGENT ∩ {OWNER, ADMIN, PlatformAdmin} = ∅`; AGENT inherits nothing; no AGENT
permission may satisfy an `isAdminOrOwner` check
(`__tests__/admin-role-drift.test.ts` already enforces the last one — extend it
to the permission table).

---

## I. Current tenant isolation model

- **One authority for the tenant:** `lib/tenant-context.ts#getActingTenantId()`
  reads `request.user.tenantId` and nothing else. No header, hostname, path,
  query or body is consulted anywhere in the module. This is correct and it is
  the single most important property in the system.
- **One authority for the principal:** `lib/principal.ts#hydratePrincipal()`
  replaces `roles` / `publisherId` / `buyerId` from the DB on every request.
- **`X-Demo-Tenant-Id`** is deleted from `request.headers` and `request.query`
  for **every** request when the flag is off — ahead of the `/api/v1` gate, so
  the `/api/automation/*`, `/api/bot/*`, retention and call-center handlers are
  covered too.
- **No `'default'` tenant, no first-active-tenant, no hostname tenant.** I
  grepped for all of them. They are gone.
- **Platform staff** get a tenant only by writing a `PlatformActingTenant` row;
  the cross-agency view has **no** tenant and agency-scoped routes refuse it
  with `409 NO_ACTING_TENANT` (distinct from `401`, so the client does not sign
  them out).
- **Platform-only routes** are gated at the `preHandler` on every single route I
  checked in `platform.ts`, `onboarding.ts`, `quotas.ts` (admin half),
  `delivery-billing.ts` (all 13 `:tenantId`-param routes), `demo.ts`, `bot.ts`,
  `demo-events.ts` and the five admin plugins in `routes/index.ts`.

**Verdict: the tenant boundary is well held server-side**, with the four
exceptions in §C (C1, C3, C4, C5). Brief questions 2.A–2.L answer as: owning
tenant is `tenantId` on the row or via `call: { tenantId }`; list, aggregate and
export endpoints are scoped (`buildCallWhere` always seeds `{ tenantId }`); a
client-supplied id is post-checked at 11 sites and pre-scoped at 41; **except**
recordings via C1, publisher links via C3, and lead lists via C4.

## J. Required agent isolation model

Two dimensions, enforced in this order, server-side, at the query:

1. **Tenant** — `where.tenantId = getActingTenantId(request)`. Already universal.
2. **Agent** — for a principal whose effective roles are exactly `['AGENT']`,
   every read narrows to rows the agent owns, and the narrowing is an
   **overwrite of any client-supplied selector, never a validation of it**
   (the pattern `routes/applications.ts:262-277` already uses).

| Surface | Ownership column | Today |
| --- | --- | --- |
| Calls | `createdById` ∪ assigned number match | ✅ `buildCallWhere` |
| Applications | `createdById` | ✅ overwrite |
| Recordings | via `call.createdById` ∪ number match | ✅ `checkRecordingAccess` |
| CRM leads | *(none exists)* | ❌ **C6** — needs an owner column and a migration |
| Payroll / time entries | `userId` | ✅ |
| My day (`/delivery/me`) | `userId` | ✅ |
| Live call control | *(none)* | ❌ **C7** — decide policy, then enforce |
| Campaigns, Publishers, Buyers, Numbers, Rate, Delivery, Settlements, Billing, Reports, Quotas | tenant-wide by nature | read-only for AGENT; no agent dimension needed |

The CRM is the one that needs a schema change, and it is the one holding the
PII.

---

## K. Frontend route / page matrix

`RG` = `RoleGuard` on the page. "Agent today" is what an AGENT-only session
actually gets.

| Required page | Route | Exists | RG | API | Agent today | Gap |
|---|---|:-:|---|---|---|---|
| Dashboard | `/dashboard` | ✔ | none | `/api/v1/reporting/*` | **redirected to `/call-center`** (`dashboard/page.tsx:178-192`) | page redirects agents away |
| Live Board | `/admin/live` | ✖ | — | — | 404 | **not built**; `pending: true` in nav |
| Calls | `/calls` | ✔ | none | `/api/v1/calls` | ✅ own calls | — |
| Applications | `/applications` | ✔ | none | `/api/v1/applications` | ✅ own rows | — |
| CRM | `/insurance-leads` | ✔ | none | `/api/v1/insurance-leads` | ⚠ **all agency leads** | C6 |
| CRM Reports | `/insurance-leads/reports` | ✔ | none | `/api/v1/insurance-leads/stats` | ⚠ tenant-wide | C6 |
| Campaigns | `/campaigns` | ✔ | `ADMIN,OWNER` | `/api/v1/campaigns` | ✖ bounced | add AGENT read-only |
| Publishers | `/publishers` | ✔ | `ADMIN,OWNER` | `/api/v1/publishers` | ✖ bounced | add AGENT read-only |
| Buyers | `/buyers` | ✔ | `ADMIN,OWNER` | `/api/v1/buyers` | ✖ bounced | add AGENT read-only |
| Numbers | `/numbers` | ✔ | `ADMIN,OWNER` | `/api/v1/numbers` | ✖ bounced | add AGENT read-only |
| Rate | `/rating` | ✔ | `ADMIN,OWNER` | `/api/v1/rating/*` | ✖ bounced + `requireAgencyPrincipal` on the API | needs an agent reading |
| Delivery | `/delivery` | ✔ | `ADMIN,OWNER` | `/api/v1/delivery/*` | ✖ bounced + `requireAgencyPrincipal` | `/delivery/me` exists and is the agent's reading |
| Settlements | `/delivery/settlements` | ✔ | `ADMIN,OWNER` | `/api/v1/delivery/settlements` | ✖ bounced + `requireAgencyPrincipal` | needs a policy decision |
| Billing | `/billing` | ✔ | `ADMIN,OWNER` | `/api/v1/billing/*` | ✖ bounced | needs a policy decision |
| Reports | `/reports` | ✔ | `ADMIN,OWNER,READONLY,ANALYST` + `reports:read` | `/api/v1/reporting/*` | ✖ bounced — **server would allow it** (A3) | add AGENT |
| Quotas & Budget | `/settings/quotas` | ✔ | none | `GET /api/v1/quota/summary` (authenticated) — admin routes are `requirePlatformAdmin` | ⚠ page loads, admin actions 403 | agency owners cannot manage quotas either |

Also in `AGENT_NAV` today but not on the required list: Call center, My day,
My payroll, Settings. These work and should stay.

**Five of the sixteen required pages require a server-side policy decision, not
a code change**: Rate, Delivery, Settlements and Billing are money screens
currently gated on `requireAgencyPrincipal` (ADMIN/OWNER of the acting agency),
and Quotas' write half is NetEnroll-only. Showing them to an agent means
deciding what an agent may see of the agency's money. That decision is the
owner's, not mine, and it is the first thing to settle before any
implementation.

## L. Backend endpoint matrix — the agent surface

| Endpoint | Guard | Tenant | Agent | Note |
|---|---|:-:|:-:|---|
| `GET /api/auth/me` | `authenticate` | n/a | self | principal-aware; the whole frontend is built from it |
| `GET /api/v1/calls` | none beyond auth | ✔ | ✔ | `buildCallWhere` |
| `GET /api/v1/calls/:id` | none beyond auth | ✔ | ✔ | |
| `GET /api/v1/calls/export.csv` | none beyond auth | ✔ | ✔ | mints a 7-day token — **C2** |
| `GET/POST /api/v1/applications` | `authenticate` | ✔ | ✔ | overwrite pattern — the model to copy |
| `GET /api/v1/insurance-leads*` (18) | `authenticate` | ✔ | ✖ | **C6** |
| `GET /api/v1/recordings/:id/{url,stream,download}` | `authenticate` | ✔ | ✔ | `checkRecordingAccess` |
| `GET /api/v1/recordings/local-stream/*` | **none** | ✖ | ✖ | **C1** |
| `/api/v1/agent/*` (16) | `requireAgent` | ✔ | ✖ | **C7** |
| `/api/v1/time-entries*`, `/api/v1/user/{banking,payouts}` | `authenticate` | via user | ✔ | correct |
| `/api/v1/admin/{time-entries,payroll*}` (6) | `requireRole('ADMIN','OWNER')` | ✔ | n/a | correct |
| `GET /api/v1/delivery/me` | `authenticate` | ✔ | ✔ | correct |
| `/api/v1/delivery/*` (money) | `requireAgencyPrincipal` | ✔ | n/a | correct today; §K may change it |
| `/api/v1/platform/**`, `/api/v1/quota/admin/**`, `/api/v1/bot/**`, `/api/v1/demo/**` | `requirePlatformAdmin` | ✔ | n/a | correct |
| `POST /api/v1/users/invite` | `isAdminOrOwner` | ✔ | n/a | **C3** on `publisherId` |
| `POST /api/v1/auth/activation-grants` | OWNER/ADMIN, AGENT-only role | ✔ | n/a | correct |

---

## M. Test plan

Written as assertions, in the order they should be built. Each one fails today
unless marked.

**M1 — role integrity (unit, `middleware/rbac.ts`)**
1. `ROLE_PERMISSIONS.AGENT` equals the §H keep-list exactly. Fails today.
2. No AGENT permission satisfies `permissionMatches('admin:*', p)`. Passes.
3. `AGENT ∩ {users:write, roles:write, *:delete, billing:write, payroll:write, payroll:admin} = ∅`. Fails today.

**M2 — lifecycle (integration, real DB)**
4. Invite → activate → `/api/auth/me` returns exactly `['AGENT']`, the inviter's
   `tenantId`, `isPlatformAdmin: false`. Passes.
5. The same token replayed 100 times returns the same role set. Passes.
6. Granting ADMIN in the DB mid-session changes `/api/auth/me` on the **next**
   request with no re-login — and revoking it reverts on the next request.
   Passes; this is the assertion that documents "there is no 20-minute state".
7. A token whose `roles` claim is hand-forged to `['ADMIN','OWNER']` is answered
   with the DB role set. Passes.
8. An agent whose only `UserRole` row is deleted gets a named "no role" state,
   not the Dashboard-only nav. Fails today.

**M3 — tenant isolation (integration, two tenants A and B)**
9. Agent of A on every `GET` in the route table: zero rows belonging to B.
10. Agent of A fetching each of B's ids by path parameter: 404/403, never 200.
11. `GET /api/v1/recordings/local-stream/<B's storageKey>` **with no
    `Authorization` header**: refused. Fails today — **C1**.
12. `POST /api/v1/users/invite` with B's `publisherId`: refused. Fails today — **C3**.
13. CRM import naming B's `leadListId`: refused. Fails today — **C4**.
14. Every CSV export and every aggregate endpoint, driven as A, contains no B row.
15. With `ALLOW_DEMO_TENANT_AUTH` unset, `X-Demo-Tenant-Id: <B>` and no
    credential: 401 on every route. Passes; make it explicit and permanent.

**M4 — agent scope (integration, two agents in one tenant)**
16. Agent 1 sees none of agent 2's calls, applications, recordings, time entries,
    payouts or banking details. Passes except recordings edge cases.
17. Agent 1 cannot read agent 2's leads. Fails today — **C6**.
18. Agent 1 cannot hang up agent 2's live call. Fails today — **C7**, pending policy.

**M5 — frontend (component + e2e)**
19. `sidebar.tsx` renders the agent nav for `['AGENT']`, the named no-role state
    for `[]`, and an analyst nav for `['ANALYST']`. Partially fails today.
20. The nav is a pure function of `/api/auth/me`; the same response always
    produces the same nav. Passes.
21. `nav-config.test.tsx` (exists, extend): every `href` in `AGENT_NAV` resolves
    to a file under `src/app` **and** to a page whose `RoleGuard` admits AGENT.
    The second half is new and fails today.
22. e2e: sign in as a fresh agent, screenshot the nav, wait **40 minutes** with
    a poll every 60s, screenshot again, assert byte-identical nav and no 401/429.
    This is the direct regression test for the reported symptom.

**M6 — token & proxy hygiene**
23. A login token carries an `exp` claim. Fails today — **B1**.
24. No API response body or `Location` header contains `?token=`. Fails today — **C2**.
25. With `trustProxy` on and `X-Forwarded-For` set, `request.ip` is the client
    and two different clients get independent rate-limit buckets. Fails today — **B2**.

---

## N. Migration / data repair requirements

Ordered. Steps 1–3 are the production repair and can ship ahead of any code.

1. **Inventory.** Run `scripts/check-roles.sql` against production and record the
   full `email → roles` map before changing anything. Reconcile it against
   `audit_logs` (`auth.register.success`, `platform.tenant.entered`) to
   establish which grants were made by the application and which by hand.
2. **Repair, per account, by intent** — never in bulk:
   - agent with ADMIN/OWNER → delete those `user_roles` rows **and insert
     `AGENT`** in the same transaction. The existing `demote-user.sql` does only
     the delete, which is what produces the role-less Dashboard-only state.
   - account with **zero** roles → assign the intended role deliberately.
   - account with ANALYST that was meant to be an agent → replace with AGENT.
   Write an `audit_logs` row for every change.
3. **Quarantine the hand-run SQL.** Delete `scripts/seed-admin-roles.sql`, or
   move it under `scripts/DANGEROUS/` with a header stating that it grants
   Company Admin to every user on the platform. Replace `demote-user.sql` with a
   `pnpm --filter @hopwhistle/api cli roles:set <email> <ROLE>` command that is
   transactional, audited, and cannot leave an account with no role.
4. **Verify `ALLOW_DEMO_TENANT_AUTH` is unset on every production host**, and
   add the assertion to `docs/PRODUCTION_CHECKLIST.md`. (C5)
5. **Seed integrity.** Assert at boot, or in CI against the production schema,
   that every member of the `RoleName` enum has a row in `roles`. A missing row
   makes `assignGrantedRole()` silently create a role-less account
   (`routes/auth.ts:50-59`) — which is state 2 of the reported symptom, reachable
   with no human involvement at all.
6. **Schema change for C6.** The CRM has no owner column. Adding agent scope to
   `insurance_leads` needs `assignedToUserId` (nullable, indexed, FK to `users`)
   plus a backfill policy for existing rows — the only schema change this audit
   implies. Everything else is code.
7. **No migration is needed** for the AGENT permission change: `ROLE_PERMISSIONS`
   is a TypeScript constant, not data. Note that `roles.permissions` (JSONB) is
   **merged on top** of it by `getUserPermissions()`
   (`middleware/rbac.ts:209-213`), so audit that column for every role row before
   tightening the constant — `scripts/seed-admin-roles.sql` wrote
   `'["calls:*","contacts:*"]'` into the AGENT row, and `calls:*` would survive a
   change to the constant.

---

## The one thing this audit could not find

**There is no ~20-minute timer in this codebase.** I searched for every timing
constant in `apps/api`, `apps/web`, `apps/worker` and `packages`. The complete
list of anything that could change an authorization outcome over time:

| Constant | Value | Relevant? |
|---|---|---|
| Login JWT expiry | **none** — no `exp` claim at all | no |
| Redis session TTL | 24h | no — nothing authorization-relevant reads it |
| `hw_session` cookie Max-Age | 7 days | no — GET-only, re-resolved from the DB |
| Recording playback token | 1h (`recordings.ts`) / 7d (`index.ts`) | no |
| CSV export token | 7 days | no |
| Activation grant TTL | 7 days | no — consumed at registration |
| Rate limit window | **1 minute / 100 req, shared platform-wide** | **possibly — see B2** |
| Platform-context retry | 0ms, 500ms, 1500ms | no |
| Logout-loop window | 30s | no |
| `NumberPoolService.REAPER_THRESHOLD_MINUTES` | **20 minutes** | **no — but read the next paragraph** |
| React Query / SWR staleTime | **n/a — neither `@tanstack/react-query` nor `swr` is a dependency** | no |
| Next.js `revalidate` | none on any dashboard route | no |
| `cron` / `setInterval` touching roles | **none exist** | no |

`REAPER_THRESHOLD_MINUTES = 20` (`services/number-pool-service.ts:54`) is the
only literal 20-minute constant in the repository. It reclaims **pay-per-call
pool DIDs** (`poolType: 'POOL'`), not agent-assigned numbers, and
`reclaimExpiredLeases()` has **no caller anywhere in the application**. It is a
coincidence and it is recorded here so nobody spends a day on it.

Two mechanisms remain that can degrade a session over wall-clock time:

- **B2, the shared rate-limit bucket.** Because `trustProxy` is off, all users
  share one 100-req/min budget. As a shift fills up, `/api/auth/me` starts
  answering 429; `use-auth.tsx:141-150` treats any non-OK response as "no user", and
  a null user is a one-item sidebar or a bounce to `/login`. This *would* present
  as "it worked for a while, then the pages vanished", and the onset would track
  floor occupancy rather than a fixed interval — which is consistent with
  "approximately 20 minutes" being approximate.
- **A1, a human running SQL.** Which the repository has both scripts for.

**Both are distinguishable from production data in under a minute** using the
two queries in §E-verify. Until one of them is run I will not assert which
happened, because the difference decides whether the fix is a Fastify option or
a data repair — and guessing wrong is how this gets patched twice.

### Recommended order of work, once the above is settled

1. §N steps 1–4 (data repair + quarantine the SQL). No code, no deploy.
2. Set `trustProxy: true` and give login tokens an `exp`. Two lines, high value.
3. C1, then C3, C4 — real cross-tenant holes, small diffs.
4. The AGENT permission table (§H) with M1 to hold it.
5. Serve permissions from `/api/auth/me` and delete the three client-side role
   models (§F.1, §F.2).
6. The §K nav/guard work — **after** the owner has decided what an agent may see
   of Rate, Delivery, Settlements, Billing and Quotas.
7. C6 (CRM agent scope, needs a migration) and a decision on C7.
