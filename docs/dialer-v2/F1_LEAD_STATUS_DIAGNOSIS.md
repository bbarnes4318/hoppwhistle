# F-1 — `LeadStatus` diagnosis, and why the fix is blocked

Status: **investigation complete, code change STOPPED at a protected boundary.**
No code in `apps/worker/` was modified. The `LeadStatus` enum was not modified.
No migration was created.

---

## The headline finding

F-1 is not merely a compile-time defect. **It is currently the only thing
preventing an ungated production autodialer from placing outbound calls.**

`apps/worker/src/index.ts:63`

```ts
// Start Dialer Worker (The Hopper) — the single active outbound dialer.
await dialerWorker.start();
```

That call is unconditional. There is no environment variable, no feature flag,
no tenant allowlist, and no kill switch in front of it. The Hopper is running in
production right now, polling every `DIALER_POLL_INTERVAL_MS` (default **1000
ms**), selecting up to `DIALER_BATCH_SIZE` (default **50**) leads per cycle, and
bounded only by `MAX_CONCURRENT_CALLS` (default **10**).

The reason it places no calls is this line, and only this line:

`apps/worker/src/services/dialer-worker.ts:272`

```ts
// Immediately mark as DIALING to prevent re-fetch
await this.updateLeadStatus(lead.id, 'DIALING');

// Fire originate command (non-blocking)
this.originateCall(lead).catch(...)
```

`updateLeadStatus` casts into the enum:

```sql
UPDATE "leads" SET status = ${status}::"LeadStatus", "updatedAt" = NOW() WHERE id = ${leadId}
```

and `LeadStatus` (`apps/api/prisma/schema.prisma:1894`) is:

```prisma
enum LeadStatus {
  NEW
  CONTACTED
  QUALIFIED
  CONVERTED
  LOST
  DO_NOT_CALL
}
```

PostgreSQL raises `invalid input value for enum LeadStatus: "DIALING"` on the
**first lead of every batch**, the `await` rejects, and `originateCall()` — which
constructs and sends a real `originate` command to FreeSWITCH — is never reached.

**Adding `DIALING` to the enum therefore does not "fix a type error". It arms an
ungated outbound dialer.** On the next poll — within one second of the migration
committing — the Hopper would begin originating calls to every `NEW` lead in
every `ACTIVE` campaign, through the FracTEL gateway rotation, using rotated
caller IDs from the DID pool.

This is exactly the hazard the existing read-only preflight tool was built to
measure. `apps/api/src/services/hopper-preflight.ts` already carries the verdict
`REPAIR_WOULD_START_CALLS_IMMEDIATELY` and reports
`immediatelyDialableFirstCycle` — how many telephone calls a repair would place
in the first cycle. **That tool must be run against the target database, by an
operator, before any repair is authorised.** Nothing in this branch may
substitute for it, because `schema.prisma` is not the deployed schema (see F-2
below).

---

## The nine investigation questions

### 1. What state is the worker attempting to represent with `DIALING`?

A **reservation**: "this lead has been claimed by a dialer worker in this cycle,
do not select it again." The comment says so — _"Immediately mark as DIALING to
prevent re-fetch"_. It is not a call state. It is written **before** any
FreeSWITCH command is constructed.

### 2. When is that state entered?

`runDialerLoop()` → `fetchLeadsToDial(n)` returns leads, then per lead, before
origination. Entry is unconditional on selection.

### 3. When and how is it exited?

Only on one path:

```ts
this.originateCall(lead).catch(err => {
  // Revert status on failure
  this.updateLeadStatus(lead.id, 'NEW').catch(() => {});
});
```

**On success it is never exited.** Nothing in `dialer-worker.ts` writes a
terminal status. There is no ESL event handler in this worker that advances a
lead to `CONTACTED`, `QUALIFIED`, `CONVERTED`, or `LOST`. A successfully
originated lead would remain `DIALING` permanently.

### 4. Persisted before origination, after, or only during reservation?

**Before origination**, as a reservation. This matters: the state does not mean
"a call is in progress"; it means "a worker intends to place a call". Those come
apart whenever origination fails, the worker dies, or FreeSWITCH is unreachable.

### 5. What status is currently used for an actively reserved or dialed lead?

**None exists.** The enum has no reservation or in-progress member. The six
members are a CRM outcome ladder (`NEW → CONTACTED → QUALIFIED → CONVERTED`,
plus `LOST` and `DO_NOT_CALL`), not a dialing state machine.

The second dialer, `apps/worker/src/services/autodialer.ts:89`, works around this:

```ts
// 2. Update Status (Use 'CONTACTED' instead of 'DIALING' to prevent crash)
await prisma.lead.update({ where: { id: lead.id }, data: { status: 'CONTACTED', ... } });
```

That workaround is **not a model to copy** — see question 6. It is also currently
inert: `apps/worker/src/index.ts:74` has `// await dialer.start();` commented out.

### 6. Would replacing `DIALING` with an existing status preserve the state machine?

**No.** Substituting `CONTACTED` — the only candidate — breaks three things:

1. **It lies to the CRM and to reporting.** `CONTACTED` means a human was
   reached. Writing it before the `originate` command is even sent marks every
   lead as contacted whether it rings, is busy, is disconnected, or is never
   dialed at all. Every conversion-rate denominator downstream becomes wrong.
2. **It is irreversible in practice.** `fetchLeadsToDial` selects
   `WHERE l.status = 'NEW'`. A lead moved to `CONTACTED` is never selected
   again, so a failed origination silently retires the lead forever. The Hopper's
   own revert path (`→ 'NEW'`) exists precisely because a reservation must be
   releasable; `autodialer.ts` has no revert, and swallows the error.
3. **It does not prevent double-selection any better**, while destroying the
   ability to distinguish "reserved" from "actually spoken to".

So Option B as specified — reuse an existing status — has **no correct
candidate** in the current enum.

### 7. Would adding `DIALING` create a new durable business state?

**Yes**, and the branch is not ready for it. Every consumer would have to
understand it, and today none does:

| Consumer                               | Current handling of a new member                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchLeadsToDial` selection predicate | selects only `NEW`; a `DIALING` lead is invisible forever                                                                                                 |
| Hopper terminal transitions            | none exist — nothing moves a lead out of `DIALING` on success                                                                                             |
| Crash recovery / reaper                | **none exists anywhere in the worker**                                                                                                                    |
| `fronter-bot.ts`                       | writes `IN_CALL` / `TRANSFERRED` / `FAILED`, which are _also_ not enum members, inside a `try/catch` that logs and continues — so it fails silently today |
| UI / reporting                         | no mapping for a dialing state                                                                                                                            |

Adding the member without also adding the transitions and the reaper converts a
loud, total failure into a **silent, partial one**: leads would drain out of the
dialable pool into a terminal-in-practice state at up to 50 per second.

### 8. What happens to leads stranded in `DIALING` after a worker crash?

They are **stranded permanently**. There is no reaper, no timeout, no
`updatedAt` sweep, and no requeue anywhere in `dialer-worker.ts` (verified by
grep for `stale|reap|stranded|requeue|updatedAt <` — no matches). Because
selection is `status = 'NEW'`, a stranded lead is never re-selected and never
dialed again. A single crash mid-batch silently retires up to 50 leads.

Any Option A implementation therefore **requires** a reaper as part of the same
change, not as a follow-up.

### 9. Does the production Hopper depend on enum ordering, values, or queries?

- **Ordering:** no. Selection orders by `l."createdAt" ASC`, not by status.
  `ALTER TYPE ... ADD VALUE` appends and does not renumber existing members, so
  existing rows keep their meaning.
- **Values:** yes, on two literals — `'NEW'` for selection and `'DIALING'` for
  reservation. Neither is renamed by any proposal here.
- **Queries:** yes. The selection predicate is the coupling point. Any new state
  must be reflected in it, or in a reaper that returns leads to `NEW`.

---

## F-2 compounds this: `schema.prisma` is not the deployed schema

`LeadStatus` and the `leads` table appear in **no migration in this repository**:

```bash
grep -rn 'CREATE TYPE "LeadStatus"\|CREATE TABLE "leads"\|ALTER TYPE "LeadStatus"' apps/api/prisma/migrations/
# (no matches)
```

The only `*LeadStatus*` in a migration is `InsuranceLeadStatus`, a different enum
in `20260401_add_insurance_lead_pipeline`. The `leads` table and `LeadStatus`
therefore reached production via `prisma db push`, so **the live enum's members
are unknown from this repository**. It may already contain `DIALING`,
`IN_CALL`, `TRANSFERRED`, or `FAILED` — `fronter-bot.ts` writes the last three.

Two consequences:

1. **A migration cannot be validated from an empty database.** `ALTER TYPE
"LeadStatus" ADD VALUE 'DIALING'` fails against a database built from the
   migration history, because nothing in that history creates the type.
   Any migration adding this value must first be preceded by a migration that
   _adopts_ the existing table and enum idempotently — which is a schema-baseline
   change to a live production table, and a much larger authorisation than F-1.
2. **The domain decision cannot be finalised from static reading.** If the live
   enum already contains `DIALING`, F-1 does not apply to production at all and
   the Hopper may be dialing right now. `hopper-preflight` says exactly this and
   returns `HOPPER_MAY_ALREADY_BE_DIALING`.

---

## Decision

**Neither Option A nor Option B may be executed in this task.** Both terminate in
a protected file, and the migration route additionally depends on a fact this
repository does not contain.

**Recommended design, for authorisation — Option A, sequenced:**

`DIALING` _is_ a legitimate durable state. The Hopper genuinely needs to
distinguish available (`NEW`) from reserved-and-in-flight, and no existing member
can carry that meaning without corrupting CRM semantics. But it must land in this
order, and the order is the whole safety argument:

1. **Gate the Hopper first.** Put `dialerWorker.start()` behind an explicit
   env kill switch plus tenant allowlist, defaulted off, matching the
   `TENANT_DIALER_V2_*` pattern already used elsewhere. _Until this exists,
   every later step is a live-fire change._
2. **Run `hopper-preflight` against the target database** and record
   `leadStatusValues`, `immediatelyDialableFirstCycle`, and the verdict.
3. **Adopt the existing schema into migration history** so `leads` and
   `LeadStatus` are represented — otherwise no migration is validatable.
4. **Add the enum member**, with the transitions and the reaper in the same
   change: a terminal transition on origination success, and a sweep that
   returns leads whose `DIALING` reservation is older than a bound to `NEW`.
5. **Update every consumer** — selection predicate, UI mapping, reporting.

Step 1 is the one that converts F-1 from an accidental interlock into an
intentional one, and it is the only step that is safe to do first.

---

## Protected files — the stop condition

| File                                           | Why authoritative                                                                                           | Governing rule                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/worker/src/services/dialer-worker.ts`    | The production Hopper. Contains the `DIALING` write, the selection predicate, and the only revert path.     | Master contract: _"Legacy workers (do NOT edit in early phases; build Dialer V2 separately instead): `apps/worker/src/services/autodialer.ts`, `apps/worker/src/services/dialer-worker.ts`."_ This task: _"Do not … modify the production Hopper."_ |
| `apps/worker/src/index.ts`                     | Starts the Hopper unconditionally. Gating it changes production dialing behaviour.                          | Same. Also _"No new worker may originate a real call unless BOTH a global env kill switch AND an explicit tenant flag are enabled."_                                                                                                                |
| `apps/api/prisma/schema.prisma` (`LeadStatus`) | The authoritative enum. Additive in Prisma terms, but its _production effect_ is to arm the ungated dialer. | Master contract: _"never destructively alter enum values"_; and the sequencing argument above.                                                                                                                                                      |
| `apps/worker/src/services/autodialer.ts`       | Second legacy dialer, currently disabled.                                                                   | Named protected legacy worker.                                                                                                                                                                                                                      |

### Exact proposed diff — step 1, the gate (requires approval)

`apps/worker/src/index.ts`

```diff
-    // Start Dialer Worker (The Hopper) — the single active outbound dialer.
-    await dialerWorker.start();
+    // Start Dialer Worker (The Hopper) — the single active outbound dialer.
+    //
+    // Gated. Until 2026-08 this call was unconditional, and the only thing
+    // preventing outbound dialing was that the Hopper wrote a LeadStatus value
+    // the enum did not contain (F-1). That is an accident, not a control.
+    if (process.env.HOPPER_DIALER_ENABLED === 'true') {
+      await dialerWorker.start();
+    } else {
+      logger.warn({
+        msg: 'Hopper not started: HOPPER_DIALER_ENABLED is not "true"',
+      });
+    }
```

### Exact proposed diff — step 4, the enum (requires approval, and steps 1–3 first)

`apps/api/prisma/schema.prisma`

```diff
 enum LeadStatus {
   NEW
+  DIALING
   CONTACTED
   QUALIFIED
   CONVERTED
   LOST
   DO_NOT_CALL
 }
```

with migration `ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'DIALING';`.

**Honest rollback for that migration: there is none.** PostgreSQL cannot remove
an enum value. Reversal requires creating a replacement type, rewriting every
column that uses it, and dropping the old type — a full table rewrite of `leads`
under lock, only valid if no row holds the value. This migration must be
described as **forward-only**, and any document calling it "reversible" is wrong.

### What is required to proceed

1. Explicit authorisation to modify `apps/worker/src/index.ts` for the gate.
2. Explicit authorisation to modify `apps/worker/src/services/dialer-worker.ts`
   for the terminal transition and the reaper.
3. A `hopper-preflight` run against the target database, with the output
   recorded, before any enum change is authorised.
4. A decision on adopting `leads` / `LeadStatus` into migration history.

Until (1) is done, **no enum change should be applied to any environment that
runs the worker**, because the enum change is the trigger and the gate is the
safety.

---

## What this branch does instead

`.github/workflows/dialer-v2.yml` gains a required check that fails if
`DIALING` is added to `LeadStatus` while `dialerWorker.start()` remains
ungated. That does not fix F-1 and does not pretend to. It converts the
accidental interlock into an intentional one, so the dangerous ordering —
migrate first, gate later — cannot be merged silently.

See `HOPPER_KILL_SWITCH_GUARD` in that workflow, and
`docs/dialer-v2/PHASE_1_STAGING_VALIDATION.md` for the controlled procedure.
