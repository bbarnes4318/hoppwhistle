# DIALER V2 — PHASE 1 STAGING VALIDATION

> **Staging only. Do not run any part of this against production.**
>
> This procedure validates that Dialer V2 ingests real FreeSWITCH events, builds
> real observations, and produces real shadow decisions — while placing no calls
> and changing no telephony configuration.
>
> It requires **no change to FreeSWITCH**. Dialer V2 subscribes to events over
> ESL; it does not modify dialplans, gateways, profiles, or the directory.

> **Nothing in this document has been executed.** It is a prepared procedure.
> The commit that introduced it applied no migration and contacted no staging
> service.

## 0. Preconditions

Every row is a gate. Record the answer; do not proceed on an unrecorded row.

| #    | Precondition                                                                                                                                                  | Why                                                                                                                                                                                                  | Recorded   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| P1   | **Exact commit SHA** deployed, matching the built image                                                                                                       | A validation that cannot name what it validated proves nothing                                                                                                                                       | `________` |
| P2   | **PR #22 still draft and unmerged**                                                                                                                           | Staging validation precedes merge, not the reverse                                                                                                                                                   | ☐          |
| P3   | **Database backup completed AND restore-verified**                                                                                                            | A backup nobody has restored is a hope. Restore it to a scratch database and count rows before proceeding                                                                                            | ☐          |
| P4   | **Current migration inventory recorded** — `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at`                                  | The rollback target. Without it "roll back" has no definition                                                                                                                                        | `________` |
| P5   | **Dedicated staging PostgreSQL**, not a schema inside the production instance                                                                                 | A shared instance means a bad migration is a production incident                                                                                                                                     | ☐          |
| P6   | **Dedicated staging Redis**, and `DIALER_V2_*` keys namespaced by tenant                                                                                      | Dialer V2 writes `tenant:{id}:dialer:v2:*`; a shared Redis lets a staging replica take a lock a production replica is waiting on                                                                     | ☐          |
| P7   | **FreeSWITCH ESL access is event-only**                                                                                                                       | The transport can write exactly `auth` and `event plain`; confirm the staging ESL ACL grants nothing more                                                                                            | ☐          |
| P8   | **Origination disabled** — `TENANT_DIALER_V2_ORIGINATE_ENABLED` unset or `false`                                                                              | Defence in depth. No origination code path exists, and the flag stays off anyway                                                                                                                     | ☐          |
| P9   | **The existing Hopper remains authoritative and untouched**                                                                                                   | Dialer V2 is shadow-only. Nothing here starts, stops, or reconfigures `apps/worker`                                                                                                                  | ☐          |
| P10  | **F-1 status recorded** — run `hopper-preflight` against the staging database and record `leadStatusValues`, `immediatelyDialableFirstCycle`, and the verdict | If the staging enum already contains `DIALING`, the Hopper is not quiescent there and every "no calls placed" assertion below needs a different baseline. See `F1_LEAD_STATUS_DIAGNOSIS.md`          | `________` |
| P10a | **`LEGACY_HOPPER_ENABLED` is unset or `false` in staging**                                                                                                    | F-1 is resolved, so the enum no longer blocks the Hopper. The gate is now the only thing that does, and it must be verified rather than assumed. Check the deployed environment, not the repository. | ☐          |
| P10b | **`LEGACY_HOPPER_ORIGINATION_ENABLED` is unset or `false`**                                                                                                   | The second interlock. Even an enabled Hopper places no calls without it.                                                                                                                             | ☐          |
| P10c | **`/health` on the worker reports `legacyHopper.state`** and it is `disabled`                                                                                 | The authoritative answer. A worker that reports anything else is dialing or about to.                                                                                                                | `________` |
| P11  | **Rollback owner identified by name**, present for the window                                                                                                 | Tier 0–3 rollback below needs a person, not a document                                                                                                                                               | `________` |
| P12  | **Metrics and log access confirmed** _before_ starting                                                                                                        | Confirming access during an incident is not confirming access                                                                                                                                        | ☐          |

**Stop and get authorisation** if any step would require editing FreeSWITCH
config, touching carrier routing, applying DDL outside the staging database,
enabling origination, or modifying `apps/worker`.

## 0a. Migration procedure

Staging database only. Confirm `DATABASE_URL` points at P5's host before every
command — read it aloud if someone else is present.

```bash
# 1. Dry run. Reports what WOULD be applied. Applies nothing.
pnpm --filter @hopwhistle/api exec prisma migrate status
```

Expect exactly TWO pending migrations, and no others:

- `20260802000000_add_campaign_agent_assignments`
- `20260803000000_add_lead_dial_reservations`

**If any other migration is pending, stop** — this branch does not own it.

> Note on `prisma migrate deploy` here: audit finding F-3 records that the
> migration chain does not apply from an EMPTY database (it fails at
> `20260721_add_call_contact_relation`, which adds an index and a foreign key to
> a table no migration creates). That does not affect a staging database built
> the same way production was, because the earlier migrations are already
> recorded as applied. It does mean a staging database rebuilt from scratch
> cannot be produced from this history — see `F1_LEAD_STATUS_DIAGNOSIS.md`.

```bash
# 2. Apply, to staging only.
pnpm --filter @hopwhistle/api exec prisma migrate deploy
```

```bash
# 3. Confirm the expected objects, and only those.
psql "$DATABASE_URL" -c "\d campaign_agents"
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename='campaign_agents'"
psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE conrelid='campaign_agents'::regclass AND contype='f'"
```

Expect the table, five indexes including
`campaign_agents_tenantId_campaignId_userId_key` and
`campaign_agents_tenantId_userId_status_idx`, and three foreign keys. CI asserts
the same set (`assignment migration is additive and reversible`).

```bash
# 4. Confirm no unrelated drift. `leads` in particular must be untouched.
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name='leads' ORDER BY column_name"
```

Compare against the pre-migration capture from P4. **Any difference is a stop
condition.**

```bash
# 4b. The reservation objects, and the enum that must NOT have changed.
psql "$DATABASE_URL" -c "\d lead_dial_reservations"
psql "$DATABASE_URL" -c "SELECT indexdef FROM pg_indexes WHERE indexname='lead_dial_reservations_active_lead_key'"
psql "$DATABASE_URL" -c "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='LeadStatus' ORDER BY e.enumsortorder"
```

The index definition **must** contain `WHERE ("releasedAt" IS NULL)`. Without
that predicate a lead can be dialled exactly once, ever. `LeadStatus` **must
not** contain `DIALING` — the reservation table exists precisely so it does not.

```bash
# 5. Confirm the Prisma client was generated from THIS commit.
node -e "console.log(require('@prisma/client').Prisma.prismaVersion)"
git rev-parse HEAD
```

```bash
# 6. Confirm the assignment schema probe passes from the running service.
curl -s localhost:9092/health/ready | jq '.checks[] | select(.name=="campaign_assignments")'
```

Expect `status: "pass"`. `fail` with `schema_missing` means step 2 did not take
effect on the database the service is actually connected to.

**Rollback for this migration** is `down.sql` in the migration directory. It has
been executed end-to-end in CI — forward, back, forward again — and asserted to
leave `tenants`, `users` and `campaigns` rows intact. It **does** destroy the
assignment rows themselves, which are operator-entered with no other source:

```bash
psql "$DATABASE_URL" -c "\copy campaign_agents TO '/tmp/campaign_agents.csv' CSV HEADER"
```

Take that copy before rolling back if the rollback is expected to be temporary.

## 0b. Runtime procedure

```bash
# Start the artifact from the production image — not tsx, not source.
docker run --rm \
  -e DIALER_V2_RUNTIME_MODE=staging \
  -e REDIS_URL=<staging-redis> \
  -e DATABASE_URL=<staging-postgres> \
  -e DIALER_V2_SIP_DOMAIN=<staging-sip-realm> \
  -e DIALER_V2_ALLOWED_TENANT_IDS=<staging-tenant-id> \
  -e DIALER_V2_INTERNAL_TOKEN="$(openssl rand -hex 32)" \
  <image>:<sha>
```

`DIALER_V2_RUNTIME_MODE=staging` is **explicit and required**. An unset or
mistyped value now refuses to start rather than silently selecting `test`, which
is the mode that permits in-memory backends.

Then, in order:

| Step | Command                                                                                                             | Expect                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R1   | `curl -s :9092/health/live`                                                                                         | `200`, `live: true`                                                                       |
| R2   | `curl -s :9092/health/ready \| jq .backends`                                                                        | every value `redis` or `database`; no `memory`, `static`, or `noop`                       |
| R3   | `curl -s :9092/health/ready \| jq .backends.decisionsFenced`                                                        | `true`                                                                                    |
| R4   | `redis-cli --scan --pattern 'tenant:*:dialer:v2:*' \| head`                                                         | every key carries the staging tenant id; no other tenant appears                          |
| R5   | `curl -s :9092/health/ready \| jq '.checks[] \| select(.name=="campaign_assignments")'`                             | `pass`                                                                                    |
| R6   | Register a staging softphone, then check extension resolution in the logs                                           | resolved from the database, not a fixture                                                 |
| R7   | `curl -s :9092/status/agents` after registration                                                                    | the agent appears, SIP state from the real `sofia::register`                              |
| R8   | Place a normal human call on staging                                                                                | events ingest; **no** call-control command is sent (test 13 below)                        |
| R9   | Restart the container, then `curl -s :9092/health/ready \| jq '.checks[] \| select(.name=="state_reconstruction")'` | `pass` — state came back from Redis, not from an empty map                                |
| R10  | Stop staging PostgreSQL for 30s, poll `/health/ready`                                                               | `postgres` check turns `fail` **within one probe interval**, then recovers when restarted |
| R11  | Stop staging Redis briefly, poll `/health/ready`                                                                    | `redis` check turns `fail`; the service stays up serving `/health/live`                   |
| R12  | `docker logs <container> \| grep -Ei 'redis://[^ ]*@\|postgres(ql)?://[^ ]*@\|password\|token'`                     | **no output**                                                                             |

R10 and R11 are the ones that were impossible before this branch: PostgreSQL
health used to latch true at startup and never move.

## 0c. Acceptance criteria

All must hold. Any single failure is a stop-and-roll-back.

| #   | Criterion                                         | How verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `/health/live` returns 200 throughout             | R1, and during R10/R11                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A2  | `/health/ready` reflects each dependency honestly | R2, R10, R11 — each check moves independently                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A3  | No memory or static backend in use                | R2                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A4  | No origination path exists                        | Test 13; CI job `no origination path exists`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A5  | No duplicate lead assignment                      | Unique index verified in 0a step 3; CI proves the database itself rejects a duplicate                                                                                                                                                                                                                                                                                                                                                                                            |
| A6  | No cross-tenant data                              | R4, plus the live tenant-isolation suites                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A7  | No stale lead permanently locked                  | Now claimable, with one stated exception. Reservations carry a bounded lease, and the reaper is proven idempotent and multi-reaper-safe against real PostgreSQL. **The exception:** a reservation in `NEEDS_RECONCILIATION` is held deliberately, and needs an operator, because the evidence-based reconciler is not implemented in this branch. Run `SELECT COUNT(*) FROM lead_dial_reservations WHERE state='NEEDS_RECONCILIATION'` and expect 0 while the Hopper is disabled |
| A8  | Shadow decisions are reproducible                 | Test 12, plus fenced-decision live suites                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A9  | Existing production Hopper behaviour unchanged    | Test 13b — capture `SELECT status, COUNT(*) FROM leads GROUP BY status` before and after; it must be identical                                                                                                                                                                                                                                                                                                                                                                   |
| A10 | Rollback executes without data loss               | 0a rollback, with the CSV copy taken first                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**A7 changed with F-1's resolution.** It was previously unsatisfiable, because
Dialer V2 does not write lead state and the legacy Hopper had no lease. The
reservation lifecycle in `apps/worker` now gives every claimed lead a bounded
lease and a recovery path, so the claim is real — except for
`NEEDS_RECONCILIATION`, which is held on purpose. That state exists because a
worker that died after submitting an origination may correspond to a live call,
and the safe answer is to hold the lead rather than redial it. Resolving those
requires querying FreeSWITCH for the attempt id, which this branch is not
authorised to do.

## 1. Configure

```bash
export TENANT_DIALER_V2_ENABLED=true
export TENANT_DIALER_V2_SHADOW_ENABLED=true
export TENANT_DIALER_V2_ALLOWED_TENANT_IDS=<staging-tenant-id>
export TENANT_DIALER_V2_ALLOWED_CAMPAIGN_IDS='*'
export TENANT_DIALER_V2_ESL_INGEST_ENABLED=true
export TENANT_DIALER_V2_ESL_ALLOWED_HOSTS=<staging-fs-host>
export FREESWITCH_ESL_HOST=<staging-fs-host>
export FREESWITCH_ESL_PASSWORD=<staging-esl-password>
export DIALER_V2_INTERNAL_TOKEN="$(openssl rand -hex 32)"
```

Origination flags are **not** set. They are irrelevant here — no origination
code path exists — but leaving them at their defaults keeps the validation
honest.

```bash
docker compose -f infra/docker/docker-compose.dev.yml -f infra/docker/docker-compose.dialer-v2.yml up -d dialer-v2
```

## 2. Test 1 — ESL connects

```bash
curl -s localhost:9092/status/ingestion | jq '{eslStarted, eslRefusal}'
```

**Expected:** `{"eslStarted": true, "eslRefusal": null}`

**Fails if** `eslRefusal` is `HOST_NOT_ALLOWLISTED` (host is not in
`TENANT_DIALER_V2_ESL_ALLOWED_HOSTS`), `NO_PASSWORD`, or `DISABLED`.

## 3. Test 2 — only event subscription is sent

```bash
docker logs hopwhistle-dialer-v2 2>&1 | grep '"msg":"esl command"'
```

**Expected:** exactly two lines — `auth <redacted>` and
`event plain CHANNEL_CREATE …`.

**Fails if** any other command appears, or if the password appears in plaintext.

Independent confirmation from the FreeSWITCH side:

```bash
fs_cli -x 'show channels count'   # before and after; must be unchanged by Dialer V2
```

## 4. Test 3 — existing human calls still work

Place a normal agent call through the existing softphone. Confirm two-way audio,
that the call appears in the existing call-center UI, and that the recording is
produced as usual.

**Expected:** identical behaviour to before Dialer V2 was started.

**Fails if** anything about the existing human dialing path changes. Dialer V2
subscribes to events; it must be invisible to call handling.

## 5. Test 4 — existing AI Voice (Dograh) calls still work

Run a staging Dograh call. Confirm the AI Voice iframe still loads and the call
completes.

**Expected:** unchanged. Dialer V2 does not touch the Dograh SSO path, the Vapi
trunk on 5070/udp, or the AI Voice route.

## 6. Test 5 — events normalize

```bash
curl -s localhost:9092/status/ingestion | jq '.metrics'
```

**Expected:** `normalized` rises as staging calls occur; `errors` stays 0.

## 7. Test 6 — tenant and campaign correlate

```bash
curl -s -H "x-dialer-v2-internal-token: $DIALER_V2_INTERNAL_TOKEN" \
  "localhost:9092/internal/shadow/decisions?tenantId=<staging-tenant-id>&limit=5" | jq
```

**Expected:** decisions for the staging tenant, with a real `campaignId`.

**Fails if** `unresolvedEventCount` on `/health` is climbing — that means the
`hopwhistle_tenant_id` channel variable is absent and events are being
quarantined rather than attributed.

```bash
curl -s localhost:9092/health | jq '.checks[] | select(.name=="unresolved_events")'
```

## 8. Test 7 — duplicate events are ignored

Restart the ESL connection to force redelivery:

```bash
docker restart hopwhistle-dialer-v2
# …then, after events resume:
curl -s localhost:9092/status/ingestion | jq '{duplicates: .metrics.duplicates, outOfOrder: .metrics.outOfOrder}'
```

**Expected:** `duplicates` > 0 after a reconnect that redelivers, and observed
call counts do **not** double.

## 9. Test 8 — internal token is enforced

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "localhost:9092/internal/shadow/decisions?tenantId=<staging-tenant-id>"
```

**Expected:** `401`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'x-dialer-v2-internal-token: wrong' \
  "localhost:9092/internal/shadow/decisions?tenantId=<staging-tenant-id>"
```

**Expected:** `401`, with a response body identical to the previous one.

## 10. Test 9 — demo tenant header cannot reach the API

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'x-demo-tenant-id: any-tenant' \
  https://<staging-api>/api/v1/dialer-v2/shadow/decisions
```

**Expected:** `401`. This is the defect fixed in `fix(dialer-v2): require
verified auth for shadow routes`; re-verify it on the deployed build, not only
in tests.

## 11. Test 10 — agent heartbeat is received

Sign a staging agent into the workspace, then:

```bash
curl -s -H "x-dialer-v2-internal-token: $DIALER_V2_INTERNAL_TOKEN" \
  "localhost:9092/internal/agents/state?tenantId=<staging-tenant-id>" | jq '.agents'
```

**Expected:** the agent appears with `sipRegistered: true` and a recent
`lastHeartbeatAgeMs`.

## 12. Test 11 — reconciliation marks stale agents

Close the agent's browser tab without signing out. Wait past the heartbeat
timeout (default 30 s), then:

```bash
curl -s -H "x-dialer-v2-internal-token: $DIALER_V2_INTERNAL_TOKEN" \
  "localhost:9092/internal/reconciliation/corrections?tenantId=<staging-tenant-id>" | jq
```

**Expected:** a correction with `reason: "heartbeat_expired"`, the agent moved to
`STALE`, and `capacity.available` reduced by one.

## 13. Test 12 — shadow decisions are created

```bash
curl -s -H "x-dialer-v2-internal-token: $DIALER_V2_INTERNAL_TOKEN" \
  "localhost:9092/internal/shadow/decisions?tenantId=<staging-tenant-id>&limit=3" \
  | jq '.decisions[] | {recommendedOriginateCount, bindingConstraint, originated, explanation}'
```

**Expected:** every record has `"originated": false` and a populated
`bindingConstraint`.

## 14. Test 13 — no originate, no state change

The critical negative tests. All four must hold.

```bash
# 13a. No originate reached FreeSWITCH.
fs_cli -x 'console loglevel' >/dev/null
docker logs hopwhistle-dialer-v2 2>&1 | grep -Ei 'originate|bgapi|uuid_|sendmsg|bridge' | grep -v 'refused'
```

**Expected:** no output.

```bash
# 13b. No lead status changed. Run before and after; compare.
psql "$STAGING_DATABASE_URL" -c \
  "SELECT status, COUNT(*) FROM leads GROUP BY status ORDER BY status;"
```

**Expected:** identical counts before and after the validation window.

```bash
# 13c. No campaign status changed.
psql "$STAGING_DATABASE_URL" -c \
  "SELECT status, COUNT(*) FROM campaigns GROUP BY status;"
```

**Expected:** identical.

```bash
# 13d. No call was hung up or bridged by Dialer V2.
fs_cli -x 'show channels'
```

**Expected:** channel count and identities driven entirely by the existing
Hopper / softphone / Dograh paths.

## 15. Test 14 — supervisor page shows real staging data

Open `/dialer-v2-shadow` as a staging supervisor (a real signed-in session, not
a demo header).

**Expected:**

- the banner reads `SHADOW MODE — NO CALLS ARE BEING PLACED`;
- ESL shows Connected with a recent last-event time;
- counters match `/status/ingestion`;
- the decisions table shows real campaign ids;
- with no staging traffic, the empty state says nothing has been observed rather
  than showing zeros styled as healthy.

## 16. Failure conditions — stop immediately

Any of these means stop and investigate before continuing:

| Condition                                             | Meaning                                     |
| ----------------------------------------------------- | ------------------------------------------- |
| Any ESL command other than `auth` / `event plain`     | The read-only guarantee has been broken     |
| The ESL password appears in any log                   | Redaction has been bypassed                 |
| Lead or campaign status counts change                 | Something is writing that must not          |
| FreeSWITCH channel count changes because of Dialer V2 | A call was placed or torn down              |
| A shadow record with `originated: true`               | Structurally impossible; a real defect      |
| `unresolvedEventCount` climbing steadily              | Tenant correlation is failing               |
| Existing human or Dograh calls degrade                | Ingestion is interfering with call handling |
| `401` not returned for a missing internal token       | Service auth is not enforced                |
| `x-demo-tenant-id` returns data                       | The security fix has regressed              |

## 17. Rollback

Fastest first. None of these interrupt a call in progress.

```bash
# Tier 0 — stop ingestion, keep the container.
export TENANT_DIALER_V2_ESL_INGEST_ENABLED=false
docker restart hopwhistle-dialer-v2
```

```bash
# Tier 1 — stop shadow evaluation.
export TENANT_DIALER_V2_SHADOW_ENABLED=false
docker restart hopwhistle-dialer-v2
```

```bash
# Tier 2 — remove the service entirely.
docker compose -f infra/docker/docker-compose.dev.yml -f infra/docker/docker-compose.dialer-v2.yml down dialer-v2
```

```bash
# Tier 3 — remove the compose overlay. Nothing else references it.
```

Because Dialer V2 is a separate container that writes to no existing table and
sends no call-control command, removing it cannot affect the Hopper, the
softphone, Dograh, FracTEL routing, or any existing record. There is no data
migration to reverse.

## 18. Sign-off

Record for each test: operator, timestamp, observed output, pass/fail. Phase 2
must not begin until tests 1–14 pass and every negative test in §14 holds.
