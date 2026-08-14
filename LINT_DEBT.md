# Lint debt — `wip/attempt-reconciliation`

**Status: RESOLVED.** All 79 eslint errors are cleared. This file is kept as the
record of what the debt actually was, because the answer was not what the error
count suggested.

The branch was originally parked with `--no-verify` in `8c577f31` to give ~6,700
lines of attempt-reconciliation work a history — the code had none anywhere else
in the repo and was living only in a `git stash` entry. The cleanup is a separate
commit so its diff is reviewable on its own.

## What the 79 errors actually were

76 of 79 were in two files that were **not part of this feature at all**:

| File                                                               | Errors | What it was                                                     |
| ------------------------------------------------------------------ | ------ | --------------------------------------------------------------- |
| `apps/api/src/services/ebbase.ts`                                  | 64     | Superseded draft of `__tests__/event-bus.test.ts`               |
| `apps/api/src/services/ildbase.ts`                                 | 12     | Superseded draft of `__tests__/insurance-lead-delivery.test.ts` |
| `apps/api/src/routes/dialer-v2-reconciliation.ts`                  | 2      | Unnecessary type assertions                                     |
| `apps/worker/src/services/__tests__/reconciler-supervisor.test.ts` | 1      | `async` arrow with no `await`                                   |

`ebbase.ts` and `ildbase.ts` were vitest test files saved into `src/services/`
instead of `src/services/__tests__/`. That misplacement is the whole story:

- It made their relative imports wrong by exactly one directory level, which is
  why `../event-bus.js`, `../redis.js` and `../insurance-lead-delivery.js` were
  unresolvable. All three targets existed the entire time, in the same directory
  as the importer.
- An unresolved import yields `any`, and `any` propagates — which is where the
  other ~70 `no-unsafe-*` errors came from.
- They matched no test glob (`*.{test,spec}.*`), so **no runner ever executed
  them**, and nothing in the repo imported them.

Both were deleted. Before deleting, each was diffed against its real counterpart
in **both directions**: identical test names, identical test counts, identical
`expect` counts. Nothing was asserted in a stray that the real test does not
assert, so nothing needed porting. The real tests are strictly better — the real
`event-bus.test.ts` has a Redis availability gate (`redisGate()` /
`describe.skipIf`) and the real `insurance-lead-delivery.test.ts` uses
`vi.hoisted()` so its mocks are declared above the hoisted `vi.mock` calls, which
the stray got wrong.

## The three real errors

Both assertions in `dialer-v2-reconciliation.ts` were redundant because `db` is
already non-nullable at its declaration:

```ts
const db = options.db ?? (getPrismaClient() as unknown as NonNullable<...>);
```

`db!.$queryRawUnsafe(...)` became `db.$queryRawUnsafe(...)`, and `{ db: db! }`
became `{ db }`. The `async` was dropped from a test arrow with no `await`.

## Not a lint problem, and worth recording

`reconciler-wiring.ts:23` reported
`Module '@prisma/client' has no exported member 'PrismaClient'`. That was a
codegen gap, not a defect: `prisma generate` had never run in this checkout.
Running it cleared **all 18** `tsc` errors in `apps/worker`, not just that one.

## Verified after cleanup

- `npx eslint` over every `.ts` file in `8c577f31`: **0 errors** (1 pre-existing
  `no-explicit-any` warning in `apps/api/src/index.ts:99`, untouched)
- `tsc --noEmit` on `apps/worker`: **0 errors**
- 111 tests across 6 reconciliation test files: **all pass**

## What remains

- **The Prisma migration `20260804000000_add_attempt_reconciliation` has never
  been applied to any database.** It exists on this branch only.
- **`reconciliation.live.test.ts` has never run.** It is excluded by config
  (`exclude: src/**/*.live.test.ts`) and needs real Redis, FreeSWITCH and
  Postgres. Every passing test above is a unit test, so the correct statement is
  "the logic is well tested", not "the feature works".
- `apps/api` still has pre-existing `tsc` errors in 68 files untouched by this
  branch. Not this work's debt.
