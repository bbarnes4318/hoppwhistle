# Platform staff and the acting-tenant switch — Phase 1b, extended in Phases 2 and 5

Phase 1 established that the acting tenant comes from `request.user` and nothing
else, and `apps/api/src/lib/tenant-context.ts` is still the only place that
question is answered. This phase adds the one thing that rule left unsolved:
NetEnroll's own staff need to see and act across every agency, and the roles
available (`OWNER`, `ADMIN`) are granted per-tenant.

**Nothing in Phase 1 was relaxed.** The helper is byte-identical. The switch
populates `request.user`; it does not teach the helper a second way to find a
tenant.

**Phase 5 changed what "no agency selected" LANDS ON, not what it resolves to.**
An operator with no acting tenant still gets no tenant and still cannot read
agency-scoped data; what they now get instead is the platform-wide reading of
the three screens NetEnroll staff actually run the platform from, rather than a
prompt to pick somebody. See §2f.

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

### The conversion missed fourteen routes, not three

A production console capture showed `GET /api/v1/agent/webrtc/credentials`,
`GET /api/v1/agent/my-numbers` and `PUT /api/v1/agent/status` still answering
401 for an operator with no agency selected. Sweeping the real route table found
**thirteen GETs and one PUT**, from **two** separate causes — so fixing the
three that were visible would have left eleven behind.

**Cause one: a route file with its own refusal.** `routes/agent-phone.ts` had a
local `requireAgent()` that read the credential and the tenant together and
answered one 401 for either. The Phase 2 conversion worked through the shared
helpers in `lib/tenant-context.ts`; a handler that never called them was never
reached by it. `requireAgent()` now checks the two conditions in order — no
credential is 401, no agency is whatever `describeTenantRefusal` says — which is
the same distinction the shared helper draws, made in the one place this file
decides it.

**Cause two: a plugin that destroyed the answer before the handler ran.**
`registerReportingRoutes` installed its own `onRequest` hook that re-verified the
JWT and assigned the **raw decoded payload** over `request.user`. The global
hook in `middleware/api-v1-auth.ts` had already authenticated the request and
run `applyPlatformContext()`, which is what sets `isPlatformAdmin` and the
acting-tenant fields; the plugin-local hook overwrote all of it with a token
body that contains none of those. Every handler in that plugin then saw a user
who was not staff and had no agency, and refused accordingly. The hook is
deleted — it was duplicating work the global hook already does — and a comment
in its place says why nothing may re-assign `request.user` there.

Sixteen sites that still wrote `reply.code(401).send({ error: 'Unauthorized' })`
after a tenant lookup now call `replyTenantRefusal` (15 in `routes/index.ts`,
1 in `routes/buyer-billing.ts`).

**Why an audit rather than a longer list.** A list of routes to check fails the
same way the conversion did: it covers what somebody remembered.
`apps/api/src/__tests__/no-acting-tenant-audit.test.ts` registers every
agency-facing plugin the real server registers, collects the route table from
Fastify's own `onRoute` hook, and drives **every** `/api/*` GET as a platform
admin holding the capability with no agency selected. Any 401 fails the suite,
with the offending method and path in the message. A route added next year that
gets this wrong fails on the day it is added.

It sweeps GETs, not writes: a route that fails this audit is by definition one
that did not refuse, so sweeping writes blindly would execute the broken ones.
The write from the capture is listed explicitly, and any write can be added
there. Four prefixes are skipped, each with a stated reason in the file — partner
API-key ingestion, carrier webhooks and FreeSWITCH internal calls, none of which
involve a browser session. A separate case asserts the sweep collected more than
fifty routes, so a sweep that silently collected nothing cannot pass; another
asserts an anonymous caller still gets 401, because splitting the two conditions
must not have turned everything into a 409.

### The client's logout gate held; it is now also bounded

The gate is `response.status === 401 && code !== NO_ACTING_TENANT`. It is
strictly conditional on the code, so a `NO_ACTING_TENANT` refusal never signs
anybody out however it is delivered.

That is not the same as saying the fourteen routes above were harmless, and they
were not: they answered `401 UNAUTHORIZED`, which is exactly the pair the gate
lets through. The gate protects against a 409 arriving with the wrong status. It
cannot protect against a route that reports the wrong condition entirely, which
is what these did — so this was a live route back into the Phase 1b loop, closed
by fixing the routes rather than by the gate.

Since a correct gate was not enough on its own, the redirect is now also
bounded. `loopingOnLogout()` counts sign-out redirects in `localStorage`: more
than three inside thirty seconds and the client stops redirecting and logs what
is happening to the console instead. A successful response clears the counter,
so ordinary use never approaches it, and any failure to read or write storage
answers "not looping" — a broken counter must not block a legitimate sign-out.
It is a backstop, not a fix: it turns a locked-out operator into one who can see
`/login` and a console line naming the cause.

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

### The switcher crashed the whole portal, and why one field could do that

Selecting an agency threw `TypeError: s.tenants.map is not a function` and every
platform admin got "Application error: a client-side exception has occurred" on
a blank page, with no way to reach any agency.

**The defect.** `apiClient`'s `data` is the parsed response **body**, not the
payload inside it — the client does not unwrap anything.
`GET /api/v1/platform/tenants` answers `{ data: tenants }`, so the body is an
object and the array is one level in. The hook read the body as the array,
`tenants` became an object, and the switcher called `.map` on it.

**Why one field took the application down.** The switcher is in the top bar,
which is in the dashboard layout. React's response to an uncaught error during
render is to unmount from the root, so the layout went with it — the sidebar,
the top bar and every route out. That is the Phase 1b login loop's failure mode
in a different place: one narrow defect that removes every escape from itself.

**Why nothing caught it.** Phase 2 built the switcher and Phase 4 reviewed these
screens; neither exercised the switcher's primary action against a real
response. The API test that does hit this route asserted with a helper walking
the body **recursively** for any `id` key, so `{ data: [{id}] }`,
`{ tenants: [{id}] }` and a bare `[{id}]` satisfied it identically. It could not
fail on an envelope change however wrong the client was. TypeScript could not
help either: `get<T>` types the body as whatever the caller claims, so
`get<PlatformTenant[]>` against an enveloped route compiles and is wrong.

**What changed.**

| | |
| --- | --- |
| the read | `payload()` in `@/lib/api` — one named, typed unwrap, replacing three ad-hoc copies. `Array.isArray` guards the switcher's list, because the crash was a non-null non-array reaching state |
| the shape | `/platform/context` and both `acting-tenant` verbs now answer `{ data: ... }` like everything else on the surface (see §2d) |
| the test | `api-response-contract.test.ts` boots the real routes and drives the **real web client** against them, asserting what each consumer's accessor yields. Reintroducing the bug fails three of its cases |
| the blast radius | `ErrorBoundary` around the switcher and around the layout's children. A failure in the chrome now renders "Agency switcher unavailable" in place; a failure in a page keeps the shell |

Next's `error.tsx` would not have helped: it catches errors from a segment's
children, not from the layout itself, and the switcher is layout chrome.

## 2d. Every route on this surface answers `{ data: ... }`

`/api/v1/platform/*`, `/api/v1/delivery/*` and `/api/v1/rating/*` are uniformly
enveloped. Three routes in `platform.ts` used to answer with a bare object while
`/tenants` beside them was enveloped, and that inconsistency inside one file is
what made "which key do I read" a question at all. **Changed:**

- `GET /api/v1/platform/context`
- `POST /api/v1/platform/acting-tenant`
- `DELETE /api/v1/platform/acting-tenant`

The bodies are otherwise identical — the same fields, one level in. The only
consumer is `use-platform-context.ts`, updated with them; the enter and leave
calls read nothing but `response.error`, so they were unaffected either way.

**This is a breaking response change**, so the API and the web app have to
deploy together. Deploying the API alone leaves the switcher's context read
looking one level too shallow — the operator is treated as not-staff and the
switcher disappears — and the fix restores it.

Elsewhere in the app plenty of routes legitimately answer with a bare body, so
the client does **not** unwrap globally: `payload()` is called where the route
is enveloped, and `Envelope<T>` names that in the type.

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

## 2e. The softphone only starts for somebody who has a phone

The production capture showed SIP initialisation failing, a watchdog logging
"full SIP re-initialization", and the pair repeating without end — for a platform
admin who has never had an extension. Two defects in one loop.

**It was mounting for everybody.** `PhoneProvider` wraps the whole dashboard
layout, so it initialised for platform operators in the cross-agency view, for
buyers and for publishers. Each fetched agent credentials, was refused, and
handed the failure to the watchdog. It now takes an `enabled` prop, and the
layout computes it: `userRoles.includes('AGENT')` **and** `!platform.needsAgency`.
Both conditions are needed — only an agent takes calls, and an operator in the
cross-agency view has no tenant for an extension to belong to. Entering an agency
reloads the page, so the phone comes up then.

**The retry was unbounded and silent.** Five attempts now, with exponential
backoff from two seconds to a thirty-second ceiling, against a budget the
watchdog shares rather than one it can bypass — `fullReinit` returns early once
the budget is spent, which is what makes "bounded" true rather than aspirational.
A 403 or 409 from the credentials fetch ends it immediately: that is a settled
answer about who this user is, not a transient failure worth retrying.

And it says so. `phoneStatus` on the context is one of `disabled`, `connecting`,
`registered`, `retrying` or `failed`, alongside `phoneAttempts` and a
`reconnectPhone()` that resets the budget. `AgentPhonePanel` renders nothing at
all when the phone is `disabled` — a user with no softphone should not see a
softphone — and while it is retrying or failed the launcher is red rather than
the green "Available" it used to show over a dead phone, with the state and a
"Try again" button in the panel. An agent whose phone is not working can now see
that from the screen instead of from the console.

## 2f. Every page an operator can reach with no agency selected

`/api/v1/calls` and `/api/v1/live/metrics` correctly answer `409`. The question
is what the page consuming them renders in that state, and the answer is that no
such page mounts: the dashboard layout swaps the **entire** children subtree for
`<CrossAgencyPrompt />` when `platform.needsAgency` holds. Nothing renders, so
nothing fetches, so there is no 409 for a page to mishandle. That is what makes
the rule hold for every page at once rather than page by page.

### Phase 5: the prompt is the exception, not the entry point

The rule above was right about the mechanism and backwards about the default.
NetEnroll staff run the whole platform; drilling into a single agency is the
exception. An operator with no agency selected was told "Choose an agency" on
`/delivery` and `/rating` and could see nothing until they picked one, so "how
is the platform doing this morning" could only be answered one agency at a time.

Three screens now have a platform-wide counterpart and are exempt from the swap.
Each decides for itself, from `usePlatformContext`, which reading to render:

| Path | With no acting tenant | Inside an agency |
| --- | --- | --- |
| `/delivery` (exact) | every agency's calls, applications, closing percentage, block remaining, overrun, ceiling distance and rate, with platform totals | that agency's own live panel |
| `/rating` | every agency's closing percentage, current rate and tracking rate, side by side | that agency's own rate |
| `/delivery/settlements` | every agency's settlements over a range, filterable by agency, export widened to match | that agency's own history |

Each is a component boundary rather than an early return inside one component:
the agency panel calls hooks, and returning before them would be a conditional
hook — and splitting means the agency panel never mounts for an operator with no
agency, so it never fires the request that would be refused 409.

**`/delivery` is matched exactly, not by prefix.** `/delivery/me` is one agent's
own numbers and has no cross-agency reading at all, so it keeps the prompt. A
prefix would have quietly served it to an operator with no agency and broken it,
which is the same shape of mistake the call centre made.

**The prompt is kept where a screen genuinely cannot be shown across agencies**,
and after Phase 5 that is: `/call-center` (one agency's live queue), `/calls`
and `/calls/[id]`, `/delivery/me`, `/dashboard`, `/payroll` and `/admin/payroll`,
`/flows`, `/voice-agents`, `/retention`, `/publishers`, `/bot`,
`/dialer-v2-shadow`, and the nested `buyer` and `publisher` sections. Every one
of them is one agency's own records, queue or roster; there is no reading of
them that spans agencies, and a pooled version would be a cross-tenant aggregate
of exactly the kind §7 of docs/BILLING.md forbids.

The exemption list lives in `apps/web/src/lib/platform-routes.ts` and is
asserted by calling it, in `apps/web/src/lib/__tests__/platform-routes.test.ts`
— all four prefixes and the one exact path — for the same reason the old two
were pinned: widening it is how the rule would quietly stop meaning anything.

**Nothing an agency sees changed.** An agency OWNER holds no platform
capability, so `needsAgency` is false for them and they get the agency reading of
all three pages; and every platform endpoint behind the other reading refuses
them 403 regardless of what a page renders. `phase5-platform.test.ts` asserts
that directly — the refusal, and that it leaks no other agency's name or id —
rather than leaving it to follow from the gates.

**One page escaped it.** The layout has two return paths, and the call centre
renders fullscreen and returns early — above the swap. So `/call-center` rendered
the live queue for an operator with no agency, asked for that agency's calls,
queue and metrics, and was refused on every one. Fixed: that branch carries the
same swap, and an `ErrorBoundary` too, because a fullscreen page that throws
leaves no chrome to navigate away from.

The rest of the surface was checked rather than assumed. `/settings` and
`/admin` are the only exemptions — the signed-in person, and the platform console.
The nested `buyer` and `publisher` layouts render inside this one, so the swap
happens above them. `(research)` is a separate route group outside this layout
and is not agency-scoped.

`apps/web/src/app/__tests__/cross-agency-landing.test.ts` pins the property
rather than the reading, since a reading is what missed the call centre: no
return path may render `{children}` unguarded, the call-centre branch carries
the swap, and both paths wrap in a boundary. It stays source-level because that
property is structural and covers every return path at once, including one
added tomorrow. Everything else it used to assert is now asserted by rendering
the pages — see §2g.

## 2g. The prompt shipped anyway, and what changed about how this is checked

Everything in §2f was implemented and tested, and `/delivery` still rendered
"Choose an agency" in production for a platform admin with no agency.

### What actually happened

Two decisions, not one, and they ran independently.

The first is the swap in §2f, which was correct: `/delivery` matched exactly,
`worksWithoutActingTenant` answered true, the prompt did not apply.

The second is the **role-based redirect** higher up the same layout, which runs
in an effect as soon as the auth check settles:

```ts
if (platform.isPlatformAdmin) return;   // the guard that was there
...
if (isPublisherOnly || isBuyerOnly) router.replace(home);
```

`isPlatformAdmin` is `false` until `/api/v1/platform/context` answers, and the
auth check answers first. So for an operator who also holds `PUBLISHER` or
`BUYER` — the platform capability is a row in `platform_admins`, not a role, so
whatever agency roles that person happens to hold are still on their user — the
redirect fired in the window before the platform context landed and moved them
to `/publisher/dashboard`. That page has no cross-agency reading, so it showed
the prompt, correctly. The prompt was right about the page it was on; the
operator had been moved off the page they asked for.

Reading a value that has not loaded as though it were the answer is the whole
defect. The guard is now `if (platform.loading || platform.isPlatformAdmin)`.

### Three things that made it possible, all fixed

**One question had two answers.** `usePlatformContext` was a plain hook, so the
layout, the page inside it, the topbar switcher and the prompt each ran their
own `/api/v1/platform/context` request and each settled at its own moment —
eight requests on one page load, and a window in which components on the same
screen genuinely disagreed. It is a provider now, mounted once at the root:
one request, one state, `loading` meaning the same thing everywhere.

**`useAuth` was the same pattern, and worse.** Twenty-one call sites, ten
concurrent `GET /api/auth/me` on a single page load. That burst exhausted the
API's connection pool: the tenth answered 500, and so did the platform-context
request behind it. The client read that failure as "not a platform admin",
rendered the one-agency delivery panel to an operator who has no agency, and
that panel polled two agency-scoped endpoints which answered 409 for as long as
the tab was open. One duplicated fetch became a page of refusals. It is a
provider too, and the context request retries three times over about two
seconds rather than treating one transient 500 as "not staff".

**The page mounted before the layout knew.** `platform.loading` starts true, so
`needsAgency` started false, so `children` rendered immediately: the page
mounted, fired its agency-scoped requests, collected 409 on every one, and was
*then* replaced by the prompt. On `/dashboard` that was two refused requests per
load for a page the operator never saw. The layout now renders neither the page
nor the prompt until it knows, with the chrome left up either side.

### The polling

`/api/v1/live/metrics` was polled every five seconds on a bare `setInterval`
from the dashboard chrome, which renders above the swap — so an operator with no
agency got a 409 every five seconds for as long as the tab was open. The strip
now does not start at all without an acting tenant, and runs on
`createLivePoller`, which gained two behaviours: a loader reporting `'refused'`
ends the loop permanently (409 `NO_ACTING_TENANT` is the correct answer and will
be the correct answer in five seconds), and a loader reporting `'failed'` doubles
the wait up to a five-minute ceiling. `/api/v1/agent/my-numbers` was the same
shape in the softphone provider — `enabled` gated the SIP registration but not
that fetch — and is now behind the same gate.

### How this is verified now

The honest reading of three consecutive phases is that nothing in this
repository had ever rendered these pages. `apps/api` drove the endpoints, which
were correct every time. `apps/web` ran in a `node` environment with no DOM, and
the one test covering this decision read `layout.tsx` as text and regex-matched
the shape of an expression — so it kept passing while the expression it matched
was being evaluated against a value that had not loaded yet. A test that reads
source cannot see a race, and none of these three defects was visible anywhere
except on the screen.

Two things now render the screen.

**`apps/web/src/app/__tests__/platform-landing.render.test.tsx`** — jsdom, in
the normal suite, a few seconds. It mounts the real providers, layout, pages and
API client against a stubbed `fetch`, and it **owns the clock**: the latency of
`/api/v1/platform/context` relative to the auth check is set explicitly, so the
race is deterministic rather than a matter of how fast the API happened to be.
It asserts no prompt, no agency-scoped request, exactly one auth request and one
context request, and — for a platform admin also holding `PUBLISHER`, `BUYER` or
`AGENT`, on each of the three routes — that no redirect fired.

**`apps/web/e2e/platform-landing.smoke.mjs`** — a real browser, a blocking CI
step. It boots the API against a disposable database, boots the web app, signs
in as a platform admin with no acting tenant, and loads each of the three routes
in Chromium under four role sets. Per route it asserts, in this order:

1. **the page rendered** — the platform-wide heading is present. Named first
   because it keeps the rest honest: an app that fails to compile shows no
   prompt and fires no refused request, and would otherwise pass every check
   below. That is not hypothetical; it happened while the file was being
   written, and the assertion exists because of it.
2. **the URL did not move**;
3. **"Choose an agency" is absent**;
4. **nothing was refused** — no 4xx or 5xx from any request the load made;

and then, sitting on `/delivery` for forty-five seconds, that **the request
count stops climbing**.

It adds latency to `/api/v1/platform/context` on purpose. On one machine the API
and the database are the same machine and the window the defect lives in is a
couple of milliseconds wide — verified by removing the fix and watching the test
pass. Production is a network and a database away. Without the latency a
localhost run tests an ordering production does not have.

Like the DB-backed suites in `apps/api` it runs only against services
explicitly nominated as disposable, and in CI it **refuses rather than skips**
when it has none: a smoke test that skips inside a blocking job is a green tick
that means nothing, which is the failure this whole section is about.

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

### Added in Phase 5

| Route(s) | Gate | Why platform-wide |
| --- | --- | --- |
| `delivery-billing.ts` — `/api/v1/platform/delivery/overview`, `/settlements`, `/settlements.csv`, `/agencies` | `requirePlatformAdmin` | The platform-wide readings of `/delivery` and `/delivery/settlements`. Every one lists agencies other than the caller's, which is the definition of a surface an agency may not reach. |
| `delivery-billing.ts` — `…/agencies/:tenantId/payment-method`, `…/disputes`, `…/disputes/stand-down` | `requirePlatformAdmin` | Sets which instrument an agency is debited on, and decides whether delivery resumes after a chargeback. Both are things done TO an agency. |
| `rating.ts` — `/api/v1/platform/rating/overview` | `requirePlatformAdmin` | The platform-wide reading of `/rating`. |
| `platform.ts` — `/api/v1/platform/tenants/volume`, `…/tenants/:tenantId/non-production` | `requirePlatformAdmin` | Every tenant's call and application volume, and the marker that decides what counts toward platform totals. |
| `onboarding.ts` — 5 routes | `requirePlatformAdmin` | Creates tenants and mints an OWNER activation grant into one. There is no self-serve path and this is why. |
| `stripe-webhooks.ts` — `POST /api/v1/webhooks/stripe` | **signature**, not a capability | Stripe cannot present a bearer token. Verified against `STRIPE_WEBHOOK_SECRET` over the raw body, and refused before anything is read out of it — an unverified dispute webhook would let anybody who can reach the URL stop an agency's delivery. Nothing in the payload names a tenant: the agency is resolved from the payment intent against rows this platform wrote. See docs/BILLING.md §12. |

Two narrowings in Phase 5 rather than additions:

- `POST /api/v1/auth/activation-grants` (agency-scoped) now issues **AGENT**
  grants only. An OWNER could previously mint an OWNER link; an agency's second
  principal is now arranged with NetEnroll, who issues it from the onboarding
  surface above. The tenant was never nameable on that route and still is not.
- `GET /api/v1/platform/delivery/overview` and the platform settlements list
  narrow to the operator's **acting tenant** when they have one. That is the
  Phase 1 helper, not a new input: `?agencyId=` is a filter on a platform-wide
  list and is ignored when an agency has actually been entered, so a query
  string cannot widen past a session-level decision.

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

`apps/api/src/__tests__/platform-admin.test.ts` — 38 cases against a real
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

7. **The response shape the switcher reads** — the agency list is asserted at
   `data`, not "somewhere in the body". That assertion used `idsIn()`, which
   walks recursively and therefore passed throughout the crash; `idsIn()` is
   still used for the leak checks it suits, and now carries a comment saying it
   must not be used for shape.

`apps/api/src/__tests__/phase5-platform.test.ts` — 25 cases, also against a real
database, covering what Phase 5 changed about this surface:

- **A platform admin with no acting tenant is served every agency** on the
  endpoints behind `/delivery`, `/rating` and `/delivery/settlements`, with the
  per-agency figures and the platform totals — and the response is checked to
  contain no `NO_ACTING_TENANT` and no "Choose an agency" anywhere in it.
- **Entering narrows all three and leaving widens them again**, driven through
  the real `enterActingTenant` / `leaveActingTenant` rather than by minting a
  token that names an agency — which for staff gets an operator nothing, and is
  the property §2 pins.
- **A query parameter cannot widen past the agency entered**: `?agencyId=` for
  another agency returns the entered agency's rows.
- **An agency OWNER is refused all five platform surfaces with a 403** that
  contains neither the other agency's id nor its name, and their own three
  screens answer with their own tenant id and nothing of the other's.
- **An agency OWNER cannot create a user outside their tenant** — a `tenantId`
  in the body is not read, and the grant lands in their own agency — **cannot
  create an OWNER**, and **cannot create a platform admin** by any value of
  `role` on any endpoint.

`apps/web/src/app/__tests__/cross-agency-landing.test.ts` pins the layout's
exemption list — the four prefixes and the one exact path — and that `/delivery`
is matched exactly, so `/delivery/me` keeps the prompt.

`apps/api/src/__tests__/api-response-contract.test.ts` — 18 cases. Boots the
real routes on a real port and drives **the real web client** — the same
`apps/web/src/lib/api.ts` module the browser runs — against them over HTTP,
asserting what each consumer's accessor actually yields rather than what is
present somewhere in the body.

It pins the switcher's exact operation (`payload(...)` is an array, and
`.map()` over it returns the agency names), that the body is *not* the payload,
that `payload()` answers `undefined` rather than throwing for every non-envelope
shape, that all four platform GETs and six delivery GETs answer `{ data: ... }`,
that entering and leaving an agency do too, that the delivery panel's fields
arrive as values rather than `undefined`, and that a refusal is an error rather
than a payload. Reverting the route to a bare body fails three of its cases,
which was checked rather than assumed.

`apps/web/src/lib/__tests__/api-envelope.test.ts` — the client-side half:
`payload()` unwraps, preserves a legitimate `null`, and returns `undefined` for
every shape a component might be handed. It also pins the bug itself — that
`response.data` is the envelope, and `.map` on it throws.

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

`apps/api/src/__tests__/no-acting-tenant-audit.test.ts` — 6 cases, and the only
one here that is exhaustive rather than a list. It registers 25 route plugins,
takes the route table from Fastify's `onRoute` hook, and drives every `/api/*`
GET as an operator with no agency selected; any 401 fails, naming the route. It
also asserts the sweep collected more than fifty routes (a sweep that collected
nothing would otherwise be a green test that checks nothing), that the three
routes from the capture answer `409 NO_ACTING_TENANT` specifically rather than
merely "not 401", and that an anonymous caller still gets 401 on those same
routes. It reported fourteen offenders before the fix.

`apps/web/src/app/__tests__/cross-agency-landing.test.ts` — 4 cases on the
dashboard layout's structure: no return path renders `{children}` unguarded, the
exemption list is exactly `/admin` and `/settings`, the fullscreen call-centre
branch carries the swap, and both paths wrap in an error boundary. See §2f for
why it is source-level.

`apps/web/src/components/__tests__/error-boundary.test.tsx` — 5 cases on the
boundary's own logic: capturing into state, clearing on a `resetKey` change,
*not* clearing while the key is unchanged (which would be a render loop rather
than a recovery), and logging rather than swallowing.

Full API suite at the time of writing: **836 passed, 0 skipped**, across 64
files, with `TEST_DATABASE_URL` and `TEST_REDIS_URL` set. Web suite: **146
passed** across 13 files. Typecheck errors unchanged at 80 (API) and 129 (web);
no new lint errors.
