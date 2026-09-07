# Platform staff and the acting-tenant switch — Phase 1b, extended in Phase 2

Phase 1 established that the acting tenant comes from `request.user` and nothing
else, and `apps/api/src/lib/tenant-context.ts` is still the only place that
question is answered. This phase adds the one thing that rule left unsolved:
NetEnroll's own staff need to see and act across every agency, and the roles
available (`OWNER`, `ADMIN`) are granted per-tenant.

**Nothing in Phase 1 was relaxed.** The helper is byte-identical. The switch
populates `request.user`; it does not teach the helper a second way to find a
tenant.

---

## 1. The capability

`PlatformAdmin` — one row per operator, `userId` unique, no tenant column, no
scope, no level. Holding the row is the capability; revoking is deleting it.

It is deliberately **not** a `RoleName` value and **not** "OWNER of a special
tenant". `UserRole` grants a name *inside a tenant*, so every existing check on
OWNER or ADMIN means "an administrator of **some** agency". Modelling platform
staff that way would put the capability back inside the tenant dimension, where
a bug in tenant resolution could confer it, and would make "which agency am I
in" and "may I act across agencies" the same question. They are not.

A platform admin's `User.tenantId` is null — they belong to no agency.

## 2. The switch

| Route | Effect |
| --- | --- |
| `POST /api/v1/platform/acting-tenant` `{tenantId}` | Enter an agency. Writes the selection row + one `platform.tenant.entered` AuditLog row. |
| `DELETE /api/v1/platform/acting-tenant` | Leave. Writes one `platform.tenant.left` AuditLog row. |
| `GET /api/v1/platform/context` | `{isPlatformAdmin, actingTenant:{id,name}}` — what the UI banner renders. Authenticated, not capability-gated, because every page load asks it. |
| `GET /api/v1/platform/tenants` | The agency picker. Id, name, slug, status only — the list that lets an operator choose must not also be a cross-agency export. |

**Default is none.** A platform admin with no agency selected gets the
cross-agency view, and an agency-scoped route refuses them. "No tenant" is a
refusal, not a wildcard. It is no longer the *same* refusal an anonymous caller
gets — see §2b, which is the part that locked the owner out of production.

**The state is a table, not a header and not the session.** Not a header, query
parameter or body field, because Phase 1 removed every one of those and re-adding
one for privileged users would give the most powerful accounts the weakest
tenant resolution on the platform. Not the Redis session, because
`middleware/session.ts` catches and swallows its own errors — a switch that
decides whose data an operator is looking at must not be able to fail quietly.

**The token is not the authority.** For staff, `PlatformActingTenant` *replaces*
the tenant in the JWT rather than supplementing it. A token is issued at login
and cannot know which agency the operator entered afterwards; a stale tenant in a
long-lived token must never decide whose data is served. This is asserted: a
token minted naming agency A gets an operator nothing.

**Entering takes effect on the next request.** The middleware that builds
`request.user` has already run by the time the row is written, so the body of the
POST is not a tenant input in the Phase 1 sense — nothing in that response is
served according to the agency it names. The response says `appliesFrom:
"next-request"` so this is not a surprise.

**The audit rows cannot silently fail.** Entering and leaving each write one
`AuditLog` row through `services/audit.ts`, which no longer swallows its own
failures: if the row cannot be written, the switch fails and the operator does
not get in, rather than entering an agency unlogged. `writePlatformAudit`
originally bypassed `auditLog()` for exactly that reason — the bypass is gone now
the reason is. See `docs/TENANT_ISOLATION_AUDIT.md` §4 and
`apps/api/src/__tests__/audit-log.test.ts`.

## 2b. "No acting tenant" is a different answer from "not authenticated"

Phase 1b answered a platform admin with no agency selected the same way it
answered an anonymous caller: 401. That is honest about the outcome and wrong
about the reason, and it locked the owner out of production.

The observed failure: `/api/auth/me` returned 200, the `platform_admins` lookup
succeeded, the `platform_acting_tenants` lookup returned nothing, `tenantId`
resolved to none, every agency-scoped route refused with 401 — and the web
client reads 401 as a dead session. It cleared the token and set
`window.location.href = '/login'`. The login page loaded the app, the app called
an agency-scoped route, and round it went. Six requests in one second. The row
had to be deleted from the database by hand to restore access.

Phase 2 splits the two:

| | Meaning | What fixes it |
| --- | --- | --- |
| `401 UNAUTHORIZED` | Nobody is authenticated. | Sign in. |
| `409 NO_ACTING_TENANT` | Somebody is authenticated, holds the capability, and has entered no agency. | Pick an agency. Signing in again changes nothing. |

409 rather than 403: the caller is permitted to reach the data once they choose
an agency, so this is a conflict with the state of their session rather than
with their identity.

`lib/tenant-context.ts` decides which, in one place, and reads
`request.user.isPlatformAdmin` **only** to choose the refusal. No branch there
can return a tenant, and an operator with no selection still gets none — the
Phase 1 rule is unchanged. The ~90 route sites that hardcoded their own 401
after a tenant lookup now call the shared helper, so the distinction cannot go
missing one handler at a time.

On the client, `apps/web/src/lib/api.ts` gates the auto-logout on the error
**code** as well as the status, so moving a status code somewhere else cannot
reopen the loop, and `apps/web/src/lib/__tests__/no-acting-tenant.test.ts` pins
all three cases.

## 2c. The switcher

Phase 1b built the switch as an API and shipped no UI, which is how an operator
came to have no agency selected and no way to pick one.

`apps/web/src/components/platform/tenant-switcher.tsx` sits in the top bar on
every page. It renders **nothing at all** for an agency user — not a disabled
control, not an empty menu. For staff it shows "All agencies" when nothing is
selected and a list to enter; while an agency IS entered it is a filled amber
control carrying that agency's name, for the whole time it is entered, because
an operator looking at one agency's callers and money must not be able to
mistake it for the platform view.

Entering and leaving go through the existing endpoints and then reload the page.
The selection applies from the *next* request, so a client-side navigation would
render the new agency's chrome around the old agency's data.

`cross-agency-prompt.tsx` is where an operator with no agency lands on an agency
page: the condition, and the one action that resolves it. `/settings` and
`/admin` are exempt — neither is agency data.

**Inside an agency, an operator carries that agency's ADMIN and OWNER roles**
(`ACTING_TENANT_ROLES`), attached to the principal and never written as
`UserRole` rows. Without this the switch is a button that does nothing: the
operator would get the agency's data scope but no role within it, and the
role-aware handlers (`getUserProfile`, `buildCallWhere`, the publisher and buyer
narrowing) would show them an empty agency. It is bounded three ways — one agency
at a time, only while the row exists, and every entry and exit audited.

### ~~Known limitation, deliberate~~ — resolved in Phase 2

Routes gated on **per-tenant permissions** (`requirePermission`, which reads
`UserRole` permission arrays from the database rather than the principal)
refused a platform operator inside an agency, because they hold no role rows
there. Phase 1b recorded that as a policy decision rather than a bug and left it
open.

**The policy is decided: platform admins have full access everywhere.**
`checkPermission`, `requireAnyPermission` and `requireRole` now pass a platform
admin who has an agency selected. `requireRole` needed one more fix than the
others — it compared `userWithRoles.tenantId !== user.tenantId`, and an
operator's own `User.tenantId` is null while their acting tenant is the agency
they entered, so it rejected every platform admin who had entered anywhere.

The widening keys off the `PlatformAdmin` capability and **nothing else**. Not a
role, because roles are per-tenant and every agency has an OWNER. Not a header,
query parameter or body field, because those are exactly what Phase 1 removed
and the most privileged accounts are the worst place to reintroduce one.
`isPlatformAdmin` is written onto the principal by `middleware/auth.ts` from a
row keyed on the authenticated user id. **A user not in `PlatformAdmin` sees no
change from any of it.**

It is still bounded by the acting tenant. An operator in the cross-agency view
has no tenant, so `checkPermission` returns false — granting the permission
without a tenant would not widen what they can read, only turn a clear refusal
into an empty page. Instead the gate answers `409 NO_ACTING_TENANT`, which is
the "pick an agency" signal described in §2b.

**The capability is not self-serve, and that is now asserted.** Widening every
per-tenant gate raises the stakes on one question: can anything reachable over
HTTP write a `platform_admins` row? `apps/api/src/__tests__/platform-capability-closure.test.ts`
answers it two ways — a static sweep of every route file for a write to the
model or a call to `grantPlatformAdmin`, which runs with no database and so
fails the build on every machine; and real requests as an agency OWNER, as an
operator and anonymously, against every shape a grant could plausibly take,
asserting the row count never moves. Only `src/cli/platform-admins.ts` may grant
it, and the test pins that it is the sole caller.

---

## 3. Route survey

Every route file under `apps/api/src/routes/` was examined. The question asked of
each: **does this operate on the platform, or on one agency?**

### Re-gated on the capability

| Route(s) | Was | Why platform-wide |
| --- | --- | --- |
| `bot.ts` — all 13 routes | `requireRole('ADMIN','OWNER')` (the `TODO(netenroll)`) | One `dial.py`, one status file, one lead file, one recordings directory. No tenant dimension anywhere. An upload to `/api/bot/leads/upload` replaces the lead file every agency is dialed from. |
| `quotas.ts` — all 10 routes | `requirePermission('admin:full')` | Every route is `/admin/api/v1/tenants/:tenantId/…` and sets **another** agency's call ceilings, spend caps and budget override tokens. Nothing reads the caller's own tenant. |
| `index.ts` — `registerAdminTenantRoutes`, `registerAdminNumberRoutes`, `registerAdminCarrierRoutes`, `registerAdminTrunkRoutes`, `registerAdminRateCardRoutes` | **nothing at all** | The `/admin/api/v1/*` console: lists and creates *tenants*, carriers, trunks and rate cards across the platform. Stubs today, which is the only reason it has not leaked; a stub that becomes real behind no gate is how it would. |
| `demo.ts` — 3 routes | **nothing at all** | Every route reads the tenant with slug `demo`, a seeded platform fixture that is nobody's agency. `/demo/stats` returns its call volume, publisher and buyer counts and total invoiced revenue. |
| `demo-events.ts` — 2 routes | **nothing at all** | Takes `tenantId` **from the request body** and publishes call events onto the event bus for it — what an agency's WebSocket feed and live board render. Unauthenticated, that is cross-tenant injection: anyone could push fabricated calls onto any agency's live board. |

Two notes on the `:tenantId` in a path (`quotas.ts`) and in a body
(`demo-events.ts`): those name the **object being administered**, not the acting
tenant of the caller. Authority comes from the capability; the parameter says
which agency it is being pointed at. Conflating those two is precisely what the
old `requirePermission('admin:full')` gate did.

### Two bugs found in the gates being replaced

- `requirePermission('admin:full')` — `'admin:full'` is not in the `Permission`
  union at all (it is one of the repo's standing typecheck errors), and
  `permissionMatches` treats a user's `admin:*` as matching anything. So the
  effective gate was "holds `admin:*` in **some** tenant", which every agency
  OWNER will, **and** the `:tenantId` in the path was never compared to the
  caller's. Both are closed by the re-gate.
- `demo-events.ts` was missed by the Phase 1 audit because that audit walked
  Prisma queries, and this writes to Redis and an event bus rather than to a
  table. Worth remembering about the shape of that audit, not just this file.

### Added in Phase 3

| Route(s) | Gate | Why platform-wide |
| --- | --- | --- |
| `delivery-billing.ts` — `/api/v1/platform/delivery/*` (14 routes) | `requirePlatformAdmin` | Sets an agency's Daily Block, its maximum daily debit and its Overrun ceiling; **enrols and un-enrols it from billing, and turns real charging on and off**; suspends and resumes delivery; sells an opening block; runs the nightly settlement; and reads the cross-agency view and its export. Every one of these decides what an agency can be charged or whether it is delivered to at all, so none of them may be reachable by the agency. |
| `delivery-billing.ts` — `/api/v1/delivery/*` (10 routes) | `authenticate` + `resolveTenant` | Agency-scoped, and deliberately so: an agency reads its own block, overrun, ceiling, settlements, the derivation of one of them, its ledger and its mandate. No parameter names an agency. |

The `:tenantId` in the platform paths names the agency being administered, not
the acting tenant of the caller — the same reading as `quotas.ts` above.
`settlement.test.ts` asserts an agency OWNER is refused the cross-agency view,
the settlement run, its own ceiling override, and — added with the enrolment
switch — enrolling itself, un-enrolling itself and turning on its own charging.

**Phase 4 adds one agency-scoped route with an id in its path**:
`GET /api/v1/delivery/settlements/:settlementId/derivation`. The id names a
settlement, not a tenant, and the lookup is scoped by the acting tenant inside
the query rather than checked after — so one agency asking for another's
settlement gets a 404, which is the answer that leaks nothing about whether it
exists. `portal.test.ts` asserts that, and asserts the response does not carry
the other agency's id.

Phase 4 also puts **enrolment, un-enrolment, suspend, resume and the ceiling
override on `/admin/agencies`** as controls rather than as curl commands. That
changes nothing about the gates: each button calls the same platform-gated,
audited route it always did, and the page is not what makes them safe.

### Examined and left as agency-scoped

These are gated on ADMIN/OWNER (or an inline `isAdminOrOwner`) and **should**
be: they mean "an administrator **of this agency**", and every one derives its
tenant from `request.user` via the Phase 1 helper.

| File | Verdict |
| --- | --- |
| `payroll.ts` (`/api/v1/admin/time-entries` and 5 more, `requireRole('ADMIN','OWNER')`) | Agency-scoped — reads `user.tenantId`; an agency admin viewing their own agents' hours. |
| `admin-billing.ts` | Agency-scoped — despite the name. Phase 1 added `requireOwnBillingAccount`; the inline admin check means "admin of this agency". |
| `buyer-billing.ts`, `recordings.ts`, `live-metrics.ts`, `index.ts` (the ~57 inline `isAdminOrOwner` sites) | Agency-scoped — role checks *within* an already-tenant-scoped query. Correct as they are. |
| `carrier-routing.ts` (`requireAnyPermission`) | Agency-scoped — `CarrierRoute` carries `tenantId`; each agency routes its own calls. |
| `anveo-`, `bulkvs-`, `fractel-procurement.ts` | Agency-scoped — buying numbers *for the caller's agency*. (Named in the brief as likely platform routes; they are not.) |
| `stir-shaken.ts` | Agency-scoped — per-tenant CNAM and attestation. (Also named in the brief; also not.) |
| `industry-research.ts` | Agency-scoped — `ResearchRun` carries `tenantId`. (Also named; also not.) |
| `agent-phone.ts`, `call-center.ts`, `retention.ts`, `insurance-leads.ts`, `prospect-intake.ts`, `compliance.ts`, `flows.ts`, `ai-campaigns.ts`, `music-console-voice.ts`, `caller-id-inventory.ts`, `transcripts.ts`, `recording-analysis*.ts`, `did-routes.ts` (CRUD), `automation.ts`, `dialer-v2-shadow.ts` | Agency-scoped — all resolve the tenant from the session. |
| `auth.ts` | Mixed and correct — public login/registration plus `POST /api/v1/auth/activation-grants`, which is agency-scoped by construction (an owner invites into their own agency; there is no `tenantId` field to name another). |

### Examined, not ADMIN/OWNER-gated, flagged rather than changed

| File | Verdict |
| --- | --- |
| `aivoice.ts`, `fish.ts` | Shared third-party workspaces (one Dograh workspace, one Fish account) gated on "any authenticated user". Platform-shaped by resource, but not ADMIN/OWNER-gated, and the sharing is a documented Phase 2/3 plan with its own migration path. Out of this step's scope; flagged here so it is not lost. |
| `freeswitch-mock.ts`, `did-routes.ts` FreeSWITCH endpoints, `post.ts` `/internal/*`, `signalwire-webhooks.ts`, `websocket.ts`, `ping.ts`, `lead-inject.ts` POST | Machine callback and webhook surfaces. Explicitly out of scope for this phase per the brief; documentation left alone. |
| `health.ts` | No tenant, no data. Correctly public. |

---

## 4. Provisioning

```
pnpm --filter @hopwhistle/api platform:admins               # list
PLATFORM_ADMIN_EMAILS=owner@example.com \
pnpm --filter @hopwhistle/api platform:admins -- --sync     # provision the launch set
pnpm --filter @hopwhistle/api platform:admins -- --invite someone@example.com
pnpm --filter @hopwhistle/api platform:admins -- --grant  someone@example.com
pnpm --filter @hopwhistle/api platform:admins -- --revoke someone@example.com
```

`--sync` is idempotent: it grants to whichever of the launch set have accounts,
reports the ones that do not, and never revokes. The launch set is
`PLATFORM_ADMIN_EMAILS` (comma-separated, so the repo owner's address is not
hardcoded in a public repository) plus `joel.vasquez@outlook.com`.

It deliberately **does not create user accounts**. A login is created through the
normal activation-grant invitation path; a provisioning script that mints
accounts would be a second way in.

### 4.1 The second operator — the exact commands

**Production has exactly one platform admin.** `joel.vasquez@outlook.com` is in
the launch set but has no user account, so `--sync` reported him missing and
granted nothing. A launch set of one is a single point of failure: lose that
account and the shared dialer console, the quota routes and the
`/admin/api/v1/*` console are unreachable for everybody, with no second operator
to restore them.

Self-serve signup requires an invitation (Phase 1), and every invitation the API
can issue carries a tenant — `POST /api/v1/auth/activation-grants` invites into
the caller's **own** agency and has deliberately no `tenantId` field. Inviting
NetEnroll staff through one of those would create a NetEnroll employee inside a
customer's agency, visible in that customer's team roster and holding one of its
roles, which contradicts §1: a platform admin's `User.tenantId` is null.

So there is a third grant source, `PLATFORM_INVITE`, carrying **no tenant**.
It is issued by the provisioning command only. There is no HTTP route that mints
one, and `platform-capability-closure.test.ts` asserts that at the call site.

**Run these on the host, in this order.**

**1. Issue the invitation.** Prints a single-use token, valid seven days, bound
to that address:

```
cd /opt/hopwhistle
pnpm --filter @hopwhistle/api platform:admins -- --invite joel.vasquez@outlook.com
```

**2. Have Joel register with it.** The token is shown once and never stored in
plaintext; send it to him over something he already trusts. He runs, or you run
on his behalf with a password he then changes:

```
curl -sS -X POST https://agents.netenroll.com/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
        "email": "joel.vasquez@outlook.com",
        "password": "<a password he chooses>",
        "firstName": "Joel",
        "lastName": "Vasquez",
        "activationToken": "<the token from step 1>"
      }'
```

Expect `201`, and `"roles": []` in the response body. That is correct and is the
point: the account created belongs to **no agency** and holds **no role**. It
can read nothing at all.

**3. Grant the capability.** This is the second deliberate act, and it is the
one that confers anything:

```
pnpm --filter @hopwhistle/api platform:admins -- --grant joel.vasquez@outlook.com
```

**4. Verify there are now two.**

```
pnpm --filter @hopwhistle/api platform:admins
```

Expect two rows, both `ACTIVE`, both in the `cross-agency view`.

**If Joel already has an account** — say he was invited into an agency at some
point — `--invite` says so and tells you to skip to step 3. Note that in that
case he keeps his agency membership; `middleware/auth.ts` ignores a platform
admin's own `User.tenantId` and uses the acting tenant instead, so it changes
nothing about what he can see, but it does leave him listed in that agency's
roster. Removing him from it is a separate decision.

**Why this is not a new way in.** A `PLATFORM_INVITE` confers strictly *less*
than an ordinary grant: an ordinary one puts an AGENT or OWNER inside a paying
agency, this one produces an account with nothing. Minting it needs shell access
to the host and `DATABASE_URL` — the same bar as granting the capability
directly, which the same command already does.

---

## 5. Tests

`apps/api/src/__tests__/platform-admin.test.ts` — 32 cases against a real
database, driving the real auth hook and the real route plugins.

1. **An agency OWNER is refused every re-gated route** — the shared dialer, the
   agency picker, another agency's quota, and (separately pinned) *their own*
   agency's quota, because the point is "not a platform operation", not "wrong
   tenant". An ordinary agency user is refused; an anonymous caller gets 401
   rather than 403 so the two stay distinguishable; the operator is admitted.
2. **No acting tenant is a refusal** — the operator is refused `/api/v1/calls`,
   is still refused when the token names an agency, sees exactly one agency's
   calls after entering and none of the other's, and stops seeing them on leave.
   Phase 2 tightened these: the refusal must be `409 NO_ACTING_TENANT` and must
   **not** be 401, in both directions, so the two conditions cannot quietly
   collapse back into one.
3. **Exactly one audit row each way** — enter and leave, each naming operator and
   agency; no row for a leave with nothing to leave; a move between agencies
   records a leave *and* an enter and leaves the operator in exactly one agency;
   a refused attempt writes no row and creates no selection.
4. **Unsettable from the wire** — `X-Demo-Tenant-Id`, a speculative
   `X-Acting-Tenant-Id`/`X-Tenant-Id`, three query parameter spellings, and a
   request body all fail to select an agency; entering does not apply to the
   request that does it; a non-existent agency is refused; a selection into an
   agency that is later suspended drops back to the cross-agency view.
5. **The capability itself** — not conferred by OWNER with `admin:*`, works for a
   user with no tenant at all, revocation drops the agency too, granting twice
   creates one row.
6. **The widened per-tenant gates** (Phase 2) — an operator inside an agency is
   admitted to both gate shapes, `requireAnyPermission` (carrier routing) and
   `requireRole` (payroll); with no agency selected both answer
   `409 NO_ACTING_TENANT` rather than 403 or 401; an agency AGENT is still
   refused the payroll surface; and an operator whose capability has been
   revoked is refused with a plain 403, not the staff-only "pick an agency".

`apps/api/src/__tests__/platform-capability-closure.test.ts` — 12 cases, added in
Phase 2 alongside the permission widening and extended with the provisioning
path. Two run with no database at all: no
route file writes to `platform_admins`, and `src/cli/platform-admins.ts` is the
only caller of `grantPlatformAdmin`. Four drive real requests as an agency
OWNER, as an operator and anonymously, across every shape a grant could take —
a dedicated endpoint, a user create carrying `isPlatformAdmin: true`, a profile
update — and assert the row count never moves.

Six more cover the provisioning path end to end, because a documented path that
has never been run is a guess: a `PLATFORM_INVITE` produces an ACTIVE account
with a null `tenantId`, no roles and **no** `PlatformAdmin` row; a separate
grant is what makes it staff; the token is spent exactly once; it is refused
when presented with a different address; and no route mints a tenant-less grant.
That last check matches at the CALL SITE rather than file-wide, because
`auth.ts` legitimately contains `tenantId: null` for audit rows with no tenant —
a file-wide grep flagged those and would have had to be silenced, which is how a
real finding gets silenced too.

`apps/web/src/lib/__tests__/no-acting-tenant.test.ts` — 4 cases against the real
API client: `NO_ACTING_TENANT` never clears the session or navigates, that holds
even if the code ever arrives as a 401, and a genuine 401 still logs out.

Full API suite at the time of writing: **628 passed, 8 skipped** (38 platform
admin, 6 capability closure, 38 rating). Typecheck errors 83 → 80 (none added).
