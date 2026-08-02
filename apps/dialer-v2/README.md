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
