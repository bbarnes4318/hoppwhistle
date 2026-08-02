# DIALER V2 — ROLLOUT AND ROLLBACK

## 1. The rollback target is not what the mandate assumed

The mandate (§24.25) requires "a documented rollback to the current Hopper".

`CURRENT_STATE_AUDIT.md` F-1 establishes that **the current Hopper cannot place calls**: it
throws on every loop iteration that finds a lead, because it casts to a `DIALING` member
that `LeadStatus` does not have.

So "roll back to the Hopper" means "roll back to a dialer that places no outbound calls".
That is a perfectly safe rollback — it is the current production state — but it must not be
described to an operator as restoring dialing capability. Rolling back V2 stops outbound
dialing entirely on this path.

This is recorded here rather than quietly fixed because fixing it requires editing a
protected file and adding a production enum member, and because un-breaking it would start
real outbound calls (§6).

## 2. Rollback tiers

| Tier | Action                                     | Time    | Interrupts live calls          |
| ---- | ------------------------------------------ | ------- | ------------------------------ |
| 0    | `TENANT_DIALER_V2_EMERGENCY_STOP=true`     | < 1 s   | **No**                         |
| 1    | `TENANT_DIALER_V2_ORIGINATE_ENABLED=false` | < 1 s   | No                             |
| 2    | Remove tenant/campaign from allowlist      | < 1 s   | No                             |
| 3    | `TENANT_DIALER_V2_ENABLED=false`           | seconds | No                             |
| 4    | Scale `dialer-v2` container to 0           | ~30 s   | No — existing channels persist |
| 5    | Revert the deployment                      | minutes | No                             |
| 6    | `DROP TABLE dialer_v2_*`                   | minutes | No                             |

Tiers 0–3 are runtime flag reads, not restarts — they take effect on the next pacing tick
without a deploy. Emergency stop prevents _new_ originations and never tears down a
conversation in progress; an agent talking to a customer keeps talking.

Because V2 is a separate service and all its tables are `dialer_v2_`-prefixed, tier 6 is a
complete uninstall with no impact on any existing table, ID, or record.

## 3. Phase gates

Each phase is independently deployable and reversible. Advancement requires the gate below,
verified — not asserted.

| Phase | Gate                                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 → 1 | Flags default-off proven by test; origination gate rejects with all defaults; health endpoints live; no existing test regressed                                                         |
| 1 → 2 | Event ingestion running ≥ 7 d; dedupe verified by double replay; agent state reconciles against FS; shadow decisions persisting; **zero V2 originations**                               |
| 2 → 3 | Progressive + power validated in staging with real FS; lead lease proven under concurrent workers; compliance gate blocking verified; ≥ 1 allowlisted tenant running progressive ≥ 14 d |
| 3 → 4 | ≥ 14 d shadow with forecast error in tolerance; simulator suite green; abandonment stays under warn threshold in staged load; degradation observed and explained in the UI              |
| 4 → 5 | Blended operation without inbound starvation                                                                                                                                            |
| 5 → 6 | Reports reconcile to raw attempts; supervisor controls audited                                                                                                                          |

## 4. First real call

Real origination happens first in **staging** against a staging FreeSWITCH, to numbers the
team owns, with `maxConcurrent=1`, `maxCps=1`, one campaign, one agent, PROGRESSIVE mode.

Production origination requires, at minimum: a named allowlisted tenant, a named allowlisted
campaign, PROGRESSIVE mode, `maxConcurrent` ≤ number of logged-in agents, a supervisor
watching, and an operator with tier-0 access on the call. Predictive mode in production is
gated behind the Phase 3 shadow evidence, not behind a config toggle.

## 5. Monitoring during rollout

Abort triggers — any one of these reverts to tier 0 immediately:

- abandonment above the warn threshold for > 60 s
- assignment latency p95 > 2 s
- any origination to a lead with an existing active attempt (must be zero)
- any cross-tenant caller-ID use (must be zero)
- FS event lag > 1 s sustained
- originate error rate > 5%
- carrier failure rate above the circuit-breaker threshold

The first two of these are the ones that reach real people. The third and fourth are
correctness invariants that should be structurally impossible (partial unique indexes,
ownership check) — if either fires, a structural guarantee has failed and V2 stops rather
than continues.

## 6. Prerequisite work, deliberately excluded from this branch

Each of these requires explicit authorization and its own review. None is done here.

1. **Fix Hopper F-1** — add `DIALING` to `LeadStatus`, or change the Hopper to use an
   existing member. Production DDL + edits a protected file + would begin real outbound
   dialing on a path that currently places none.
2. **Baseline the schema into migration history** (`DATA_MODEL.md` §2) — the deployed DB was
   `db push`-ed and migration history does not describe it. Must precede any
   `prisma migrate deploy` against production.
3. **Tenancy remediation** (`MULTITENANT_GAP_ANALYSIS.md` §1–§6) — must land before V2 is
   exposed to any external tenant. Separate ordered PRs, not mixed with dialer features.
4. **Secret rotation** — the git-tracked STIR/SHAKEN private key and plaintext credentials
   in `PROTECTED_SYSTEM_INVARIANTS.md` §7. Treat as compromised; rotation needs carrier
   coordination and explicit authorization.

Items 1 and 2 block Phase 2. Item 3 blocks external-tenant exposure. Item 4 is independent
and urgent on its own timeline.

## 7. Data rollback

V2 writes only to `dialer_v2_*` tables. It does **not** write `leads.status`, `calls`,
`campaigns`, or any existing table in Phases 0–3. There is therefore no data migration to
reverse — rollback is `DROP TABLE`, and every pre-existing record is untouched by
construction rather than by careful handling.
