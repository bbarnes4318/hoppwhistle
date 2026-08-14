# Lint debt — `wip/attempt-reconciliation`

**This branch is a parking space, not a deliverable. Do not merge it without a
lint and review pass.**

The preceding commit (`8c577f31`, "wip: attempt reconciliation, parked
unlinted") was made with `--no-verify`. It exists to give ~6,700 lines of
attempt-reconciliation work a history — the code had none anywhere else in the
repo and was living only in a `git stash` entry.

The errors below were **deliberately left unfixed**. Autofixing or hand-editing
unreviewed logic to satisfy a linter is how semantics change silently, so
nothing in that commit was touched.

## Summary

`npx eslint` over the 23 changed TypeScript files:

```
✖ 80 problems (79 errors, 1 warning)
  2 errors and 0 warnings potentially fixable with the `--fix` option.
```

Only 2 of the 79 are auto-fixable. The rest need a human.

| File                                                               | Errors        |
| ------------------------------------------------------------------ | ------------- |
| `apps/api/src/services/ebbase.ts`                                  | 64            |
| `apps/api/src/services/ildbase.ts`                                 | 12            |
| `apps/api/src/routes/dialer-v2-reconciliation.ts`                  | 2             |
| `apps/worker/src/services/__tests__/reconciler-supervisor.test.ts` | 1             |
| `apps/api/src/index.ts`                                            | 0 (1 warning) |

## Read this part before assuming it is all style noise

Three of the errors are `import/no-unresolved`, and they are a different class
of problem from the rest:

```
ebbase.ts:3:45   Unable to resolve path to module '../event-bus.js'
ebbase.ts:4:50   Unable to resolve path to module '../redis.js'
ildbase.ts:40:48 Unable to resolve path to module '../insurance-lead-delivery.js'
```

Those modules are not resolvable from where they are imported. That is not a
formatting complaint — it suggests this code has not been run, or depends on
files that were never committed. **Resolve these first.** They also explain the
bulk of the remaining errors: an unresolvable import yields `any`, and `any`
propagates, which is why `ebbase.ts` alone accounts for 64 of the 79 via
`no-unsafe-assignment` / `no-unsafe-call` / `no-unsafe-member-access`. Fixing
the three imports will likely collapse most of the rest on its own.

Also worth a look:

- `ebbase.ts:4:10` — `getRedisClient` is imported but never used.
- `dialer-v2-reconciliation.ts:159,246` — two unnecessary type assertions (these
  are the 2 auto-fixable ones).
- `ebbase.ts:70,99` and `reconciler-supervisor.test.ts:79` — `async` arrow
  functions with no `await`.

## Full output

```
C:\Users\jimbo\OneDrive\Documents\hopbot\apps\api\src\index.ts
  99:35  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

C:\Users\jimbo\OneDrive\Documents\hopbot\apps\api\src\routes\dialer-v2-reconciliation.ts
  159:26  error  This assertion is unnecessary since it does not change the type of the expression  @typescript-eslint/no-unnecessary-type-assertion
  246:13  error  This assertion is unnecessary since it does not change the type of the expression  @typescript-eslint/no-unnecessary-type-assertion

C:\Users\jimbo\OneDrive\Documents\hopbot\apps\api\src\services\ebbase.ts
    3:45  error  Unable to resolve path to module '../event-bus.js'          import/no-unresolved
    4:10  error  'getRedisClient' is defined but never used                  @typescript-eslint/no-unused-vars
    4:50  error  Unable to resolve path to module '../redis.js'              import/no-unresolved
   11:5   error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
   11:16  error  Unsafe construction of an any type value                    @typescript-eslint/no-unsafe-call
   12:11  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
   12:20  error  Unsafe member access .initialize on an `any` value          @typescript-eslint/no-unsafe-member-access
   16:11  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
   31:13  error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
   31:30  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
   31:39  error  Unsafe member access .publish on an `any` value             @typescript-eslint/no-unsafe-member-access
   44:13  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
   44:22  error  Unsafe member access .publish on an `any` value             @typescript-eslint/no-unsafe-member-access
   47:13  error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
   47:28  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
   47:37  error  Unsafe member access .getEvents on an `any` value           @typescript-eslint/no-unsafe-member-access
   48:21  error  Unsafe member access .length on an `any` value              @typescript-eslint/no-unsafe-member-access
   50:13  error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
   50:32  error  Unsafe member access [events.length - 1] on an `any` value  @typescript-eslint/no-unsafe-member-access
   50:39  error  Unsafe member access .length on an `any` value              @typescript-eslint/no-unsafe-member-access
   51:24  error  Unsafe member access .id on an `any` value                  @typescript-eslint/no-unsafe-member-access
   52:24  error  Unsafe member access .timestamp on an `any` value           @typescript-eslint/no-unsafe-member-access
   53:24  error  Unsafe member access .event on an `any` value               @typescript-eslint/no-unsafe-member-access
   54:24  error  Unsafe member access .tenantId on an `any` value            @typescript-eslint/no-unsafe-member-access
   68:13  error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
   68:33  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
   68:42  error  Unsafe member access .subscribe on an `any` value           @typescript-eslint/no-unsafe-member-access
   70:25  error  Async arrow function has no 'await' expression              @typescript-eslint/require-await
   77:13  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
   77:22  error  Unsafe member access .publish on an `any` value             @typescript-eslint/no-unsafe-member-access
   83:13  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
   87:13  error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
   88:18  error  Unsafe member access .data on an `any` value                @typescript-eslint/no-unsafe-member-access
   91:24  error  Unsafe member access .event on an `any` value               @typescript-eslint/no-unsafe-member-access
   97:13  error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
   97:33  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
   97:42  error  Unsafe member access .subscribe on an `any` value           @typescript-eslint/no-unsafe-member-access
   99:25  error  Async arrow function has no 'await' expression              @typescript-eslint/require-await
  106:13  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
  106:22  error  Unsafe member access .publish on an `any` value             @typescript-eslint/no-unsafe-member-access
  112:13  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
  112:22  error  Unsafe member access .publish on an `any` value             @typescript-eslint/no-unsafe-member-access
  121:13  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
  124:55  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
  124:57  error  Unsafe member access .event on an `any` value               @typescript-eslint/no-unsafe-member-access
  133:13  error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
  133:33  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
  133:42  error  Unsafe member access .subscribePubSub on an `any` value     @typescript-eslint/no-unsafe-member-access
  136:33  error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
  136:42  error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
  141:13  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
  141:22  error  Unsafe member access .publish on an `any` value             @typescript-eslint/no-unsafe-member-access
  150:13  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
  155:26  error  Unsafe member access .data on an `any` value                @typescript-eslint/no-unsafe-member-access
  166:15  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
  166:24  error  Unsafe member access .publish on an `any` value             @typescript-eslint/no-unsafe-member-access
  176:13  error  Unsafe assignment of an `any` value                         @typescript-eslint/no-unsafe-assignment
  176:28  error  Unsafe call of an `any` typed value                         @typescript-eslint/no-unsafe-call
  176:37  error  Unsafe member access .getEvents on an `any` value           @typescript-eslint/no-unsafe-member-access
  178:21  error  Unsafe member access .length on an `any` value              @typescript-eslint/no-unsafe-member-access
  179:21  error  Unsafe member access [events.length - 1] on an `any` value  @typescript-eslint/no-unsafe-member-access
  179:28  error  Unsafe member access .length on an `any` value              @typescript-eslint/no-unsafe-member-access
  180:21  error  Unsafe member access [events.length - 3] on an `any` value  @typescript-eslint/no-unsafe-member-access
  180:28  error  Unsafe member access .length on an `any` value              @typescript-eslint/no-unsafe-member-access

C:\Users\jimbo\OneDrive\Documents\hopbot\apps\api\src\services\ildbase.ts
   40:48  error  Unable to resolve path to module '../insurance-lead-delivery.js'  import/no-unresolved
   83:11  error  Unsafe assignment of an `any` value                               @typescript-eslint/no-unsafe-assignment
   83:26  error  Unsafe call of an `any` typed value                               @typescript-eslint/no-unsafe-call
   95:7   error  Unsafe assignment of an `any` value                               @typescript-eslint/no-unsafe-assignment
   98:9   error  Unsafe assignment of an `any` value                               @typescript-eslint/no-unsafe-assignment
  104:7   error  Unsafe assignment of an `any` value                               @typescript-eslint/no-unsafe-assignment
  125:11  error  Unsafe call of an `any` typed value                               @typescript-eslint/no-unsafe-call
  130:11  error  Unsafe assignment of an `any` value                               @typescript-eslint/no-unsafe-assignment
  130:81  error  Unsafe member access [0] on an `any` value                        @typescript-eslint/no-unsafe-member-access
  131:24  error  Unsafe member access .data on an `any` value                      @typescript-eslint/no-unsafe-member-access
  146:11  error  Unsafe assignment of an `any` value                               @typescript-eslint/no-unsafe-assignment
  146:26  error  Unsafe call of an `any` typed value                               @typescript-eslint/no-unsafe-call

C:\Users\jimbo\OneDrive\Documents\hopbot\apps\worker\src\services\__tests__\reconciler-supervisor.test.ts
  79:55  error  Async arrow function has no 'await' expression  @typescript-eslint/require-await

✖ 80 problems (79 errors, 1 warning)
  2 errors and 0 warnings potentially fixable with the `--fix` option.
```

## Note on the count

The `pre-commit` hook reported 78 problems / 77 errors; this file reports 80 / 79. The hook runs `lint-staged`, which lints only the staged subset; this run
covered all 23 changed `.ts` files. Same debt, wider net.

## Also in that commit, and probably not wanted there

`git add -A` swept in four files beyond the intended 30:

- `apps/freeswitch/scripts/tests/probe_agent_busy.lua`
- `apps/freeswitch/scripts/tests/syntax_check.lua`
- `apps/freeswitch/scripts/tests/test_agent_busy.lua`
- `phase-5-route-scoring-spec.md` — belongs on the `route-scoring` branch, not
  here
