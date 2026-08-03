# @hopwhistle/dialer-v2

Predictive dialing control plane. **Phase 1 — off by default and cannot place a call.**

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

**No origination path and no lead selection.** That is structural, not a setting: the ESL
transport can write exactly two commands (`auth`, `event plain`) and refuses anything else
before it reaches the socket, and nothing in this service writes a lead status, campaign
status, disposition, or billing record. There is no switch to turn origination on, because
there is nothing to turn on. It arrives in Phases 2–3 per `ROLLOUT_AND_ROLLBACK.md`.

What IS here as of Phase 1: an inbound ESL connection, event ingestion and deduplication,
authoritative agent state, SIP registration tracking ordered by FreeSWITCH event order,
rolling per-campaign observations, database-backed extension and campaign-assignment
resolution, and shadow pacing that records what the dialer _would_ have done.

## Building

`prisma generate` must run before the build, and it is not optional.

```bash
pnpm install --frozen-lockfile
pnpm --filter @hopwhistle/api exec prisma generate
pnpm --filter @hopwhistle/dialer-v2 build
```

`@prisma/client` is a declared production dependency of this package and tsup
leaves it external, so the artifact loads it from `node_modules` at runtime
instead of carrying an inlined copy. That copy has to be there, and it only
exists after generation — `@prisma/client/default.js` re-exports
`.prisma/client/default`, which is an output directory rather than a package.

Skipping generation produces:

```text
Could not resolve ".prisma/client/default"
```

Externalizing is the right call rather than a way around that error. The
generated client is determined by the deployment's schema and engine binaries,
so an inlined snapshot would drift from the schema at the next migration and
would bake engine paths resolved on the build machine into an image with a
different libc. A client that is missing at runtime fails startup and readiness
with a named, credential-free error rather than presenting as "database
unreachable".

The `Dockerfile` runs generation in the builder stage and copies `node_modules`
into the runner, so `@prisma/client` and the generated `.prisma/client` sit
beside the artifact.

### Smoke-testing what was built

```bash
node apps/dialer-v2/scripts/smoke.mjs --mode test --allow-fail freeswitch_esl,redis,postgres
```

Starts `dist/index.js` with `node` — not `tsx`, not Vitest, not the TypeScript
source — checks `/health/live`, inspects `/health/ready` check by check, and
terminates on `SIGTERM`. Readiness is asserted per check rather than as a single
boolean, because the production run deliberately expects some checks to fail;
accepting any failure would pass just as happily with a missing Prisma client or
memory-backed sessions.

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
