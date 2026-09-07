# Platform staff and the acting-tenant switch — Phase 1b

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
cross-agency view, and an agency-scoped route refuses them with a 401 exactly as
it refuses an anonymous caller. "No tenant" is a refusal, not a wildcard.

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

**Inside an agency, an operator carries that agency's ADMIN and OWNER roles**
(`ACTING_TENANT_ROLES`), attached to the principal and never written as
`UserRole` rows. Without this the switch is a button that does nothing: the
operator would get the agency's data scope but no role within it, and the
role-aware handlers (`getUserProfile`, `buildCallWhere`, the publisher and buyer
narrowing) would show them an empty agency. It is bounded three ways — one agency
at a time, only while the row exists, and every entry and exit audited.

### Known limitation, deliberate

Routes gated on **per-tenant permissions** (`requirePermission`, which reads
`UserRole` permission arrays from the database rather than the principal) still
refuse a platform operator inside an agency, because they hold no role rows
there. `checkPermission` now returns false early for a principal with no tenant
rather than looking permissions up under `undefined`. Widening this is a policy
decision, not a bug fix, and is not in this phase. The conservative direction is
the right default.

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
pnpm --filter @hopwhistle/api platform:admins              # list
PLATFORM_ADMIN_EMAILS=owner@example.com \
pnpm --filter @hopwhistle/api platform:admins -- --sync    # provision the launch set
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

Full API suite: **540 passed, 8 skipped**. Typecheck errors 95 → 85 (none added).
