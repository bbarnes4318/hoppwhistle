# DIALER V2 — PHASE 1 STAGING VALIDATION

> **Staging only. Do not run any part of this against production.**
>
> This procedure validates that Dialer V2 ingests real FreeSWITCH events, builds
> real observations, and produces real shadow decisions — while placing no calls
> and changing no telephony configuration.
>
> It requires **no change to FreeSWITCH**. Dialer V2 subscribes to events over
> ESL; it does not modify dialplans, gateways, profiles, or the directory.

## 0. Preconditions

| Requirement                                  | Why                                                      |
| -------------------------------------------- | -------------------------------------------------------- |
| A staging FreeSWITCH with ESL reachable      | Ingestion source                                         |
| Staging ESL password                         | `auth` is one of the two commands the transport can send |
| At least one staging agent extension         | To exercise the human-call path                          |
| A staging tenant id and campaign id          | Allowlists are explicit                                  |
| No production credentials in the environment | This procedure must be incapable of touching production  |

**Stop and get authorisation** if any step would require editing FreeSWITCH
config, touching carrier routing, applying DDL, or enabling origination.

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
