# @hopwhistle/dialer-v2

Predictive dialing control plane. **Phase 0 — off by default and cannot place a call.**

Design documents live in [`docs/dialer-v2/`](../../docs/dialer-v2). Start with
`CURRENT_STATE_AUDIT.md`, then `TARGET_ARCHITECTURE.md`.

## What is here

| Path                              | What it does                                                |
| --------------------------------- | ----------------------------------------------------------- |
| `src/config/flags.ts`             | The ten kill switches. Defaults prevent origination.        |
| `src/config/redis-keys.ts`        | Tenant-scoped Redis key construction — the only builder.    |
| `src/runtime/origination-gate.ts` | The fourteen-condition gate. Reports every failing reason.  |
| `src/pacing/controller.ts`        | The adaptive pacing controller. Pure function.              |
| `src/sim/simulator.ts`            | Deterministic, seeded simulation harness.                   |
| `src/health/report.ts`            | Health that asserts dialing liveness, not process liveness. |

## What is NOT here yet

No FreeSWITCH connection, no lead selection, no origination path, no database access.
`src/index.ts` starts an HTTP health surface and nothing else. Those arrive in Phases 1–3
per `ROLLOUT_AND_ROLLBACK.md`.

## Running

```bash
pnpm --filter @hopwhistle/dialer-v2 test
```

```bash
pnpm --filter @hopwhistle/dialer-v2 typecheck
```

The live suites need a real Redis and a real PostgreSQL and skip when neither is
reachable, printing the reason:

```bash
pnpm --filter @hopwhistle/dialer-v2 test:live
```

## Runtime modes

`DIALER_V2_RUNTIME_MODE` selects which implementations the service holds. It is
read once, in `runtime/composition.ts`, and nowhere else.

| Mode          | State     | Sources         |
| ------------- | --------- | --------------- |
| `test`        | in memory | static fixtures |
| `development` | in memory | static fixtures |
| `staging`     | Redis     | PostgreSQL      |
| `production`  | Redis     | PostgreSQL      |

An unset or unrecognised value resolves to `test`, the most restrictive option.
Defaulting to `production` would let a typo in a deployment variable silently arm
the real backends; defaulting to `development` would let a real deployment
silently accept single-instance state.

**Staging and production refuse to start** when any required backend cannot be
created — they never substitute an in-memory one. The process stays up to serve
`/health/live`, so an orchestrator does not restart-loop a service that is
correctly refusing, and `/health/ready` reports which requirement was not met.

Required in `staging` and `production`:

| Variable                       | Why                                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL`                    | every piece of shared state                                                                                                                                      |
| `DATABASE_URL`                 | extension and campaign-assignment resolution                                                                                                                     |
| `DIALER_V2_SIP_DOMAIN`         | the realm agents register against; there is no per-user domain column to read, and a wrong realm makes every registration fail to resolve with no error anywhere |
| `DIALER_V2_ALLOWED_TENANT_IDS` | which tenants this replica reconstructs at startup                                                                                                               |
| `DIALER_V2_INTERNAL_TOKEN`     | gates `/internal/*`                                                                                                                                              |

Optional, and validated rather than clamped — a value this service cannot
provide is a startup failure, not a silent substitution:

| Variable                             | Default  | Constraint                                            |
| ------------------------------------ | -------- | ----------------------------------------------------- |
| `DIALER_V2_OBSERVATION_BUCKET_MS`    | `300000` | ≥ 1000; below that a bucket is noise, not a statistic |
| `DIALER_V2_OBSERVATION_BUCKET_COUNT` | `12`     | positive integer                                      |

An empty string means "not configured" and takes the default. A value that is
present but unparseable is rejected, so a typo cannot hide behind a default that
then looks deliberate.

## Why the controller is a pure function

`decidePacing(inputs, prev)` performs no I/O and reads no clock — `nowMs` is an argument.
That makes the highest-risk logic in the product testable without FreeSWITCH, Redis, or a
database, and it is what makes the simulator possible.

It is worth the constraint. Running the simulator against the first implementation found
three defects that were invisible from reading the code, including one that produced 12.8%
abandonment against a 3% target. They are written up in `PREDICTIVE_PACING_SPEC.md` §8.

## Turning it on

Origination requires all fourteen conditions in `origination-gate.ts` simultaneously. There
is no single switch, deliberately. `GET /status/flags` shows the current values and
`GET /health` shows whether origination is permitted and why not.
