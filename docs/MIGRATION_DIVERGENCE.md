# Migration history has diverged from the schema

**Status:** not urgent, not blocking. Nothing in the redesign depends on it.
It bites the first time someone stands up a **new environment**.

Measured 2026-08-30 against a fresh PostgreSQL 16 instance.

## Symptom

`prisma migrate deploy` cannot build a database from scratch. It applies 12 of
the 14 migrations and then dies:

```
Applying migration `20260721_add_call_contact_relation`
Error: P3018 ... 42P01
ERROR: relation "ai_campaign_calls" does not exist
```

`prisma db push` works, which is why nobody has hit this: CI runs
`pnpm --filter @hopwhistle/api prisma db push --skip-generate` rather than
`migrate deploy`, so the migration history is never exercised anywhere.

## What has actually diverged

**19 tables are declared in `schema.prisma` and created by no migration.**
`db push` conjures them from the schema; a migration replay never does.

```
ai_campaign_calls      campaign_publishers   lead_lists        retention_policies
ai_campaign_contacts   did_routes            leads             time_entries
buyer_bids             insurance_activities  payroll_payouts   user_financials
buyer_transactions     insurance_tasks       ping_requests     voice_agents
campaign_buyers        lead_calls            retention_notes
```

77 tables carry an `@@map`; only 60 are created by a migration.

The immediate failure is narrower than the list suggests:
`20260721_add_call_contact_relation` adds an index and a foreign key **to**
`ai_campaign_calls`, a table no migration ever creates. So the history is not
merely incomplete — it references its own gaps.

## Where the drift started

| migration                                       | CREATE TABLE | ALTER TABLE |
| ----------------------------------------------- | -----------: | ----------: |
| `20251109061412_init`                           |           39 |          54 |
| `20251212172909_recording_analysis`             |           11 |          28 |
| `20260125183000_enterprise_call_tracking`       |            0 |          36 |
| `20260126_add_buyer_targets_and_stats`          |            1 |          10 |
| `20260401_add_insurance_lead_pipeline`          |            2 |           3 |
| `20260718000000_add_industry_research`          |            4 |           2 |
| `20260721_add_call_contact_relation`            |            0 |           1 |
| `20260802000000_add_campaign_agent_assignments` |            1 |           3 |
| `20260803000000_add_lead_dial_reservations`     |            1 |           3 |

The two `init` migrations account for 50 of the 60 created tables. Everything
after them is mostly `ALTER`, and the tables added by feature work since
January largely arrived through `db push` instead of a migration.

## Why it matters, and when

- **A new environment cannot be built from the migration history.** Staging, a
  fresh developer machine, disaster recovery, or a second region all need
  `db push` today, which means no reviewable DDL and no rollback.
- **Nothing verifies migrations.** Since CI uses `db push`, a broken migration
  can be merged and will not be noticed until someone provisions a database.
- ~~Production and CI are unaffected right now.~~ **Not true any more.** See
  below.

## Production IS affected, and here is the command that says how much

Measured 2026-09-11. The line above has been overtaken.

`scripts/deploy-netenroll.sh` is now the only path by which a migration reaches
the production database, and it applies the files named in a **hand-maintained
list**:

```sh
REQUIRED_MIGRATIONS="
20260906000000_add_tenant_activation_grants
...
```

A migration in `prisma/migrations` and not in that list is applied nowhere. The
deploy runs to completion, reports success, and starts an API whose queries
name columns that do not exist. `prisma/migrations` holds 31 dated migrations;
six were listed, and eleven are after #113 added the five billing ones. Twenty
are still unlisted, and which of those matter is not known — that is the gap
`scripts/schema-drift.sh` below exists to close. Three consequences found the
hard way, each when something broke rather than when it was introduced:

| found as | actually |
| --- | --- |
| `/api/v1/live/strip` 500, `P2022` | `insurance_carrier_applications.voidedAt` absent |
| `relation "lead_dial_reservations" does not exist`, mid-deploy | the whole table absent |
| read by eye, in a second pass over the script | five billing migrations unlisted |

So the drift is no longer only a new-environment problem. It is a live one, and
until now the only way to enumerate it was to wait for the next 500.

### `scripts/schema-drift.sh`

Answers it in one run, read-only, against any database:

```bash
./scripts/schema-drift.sh                    # DATABASE_URL from apps/api/.env
./scripts/schema-drift.sh --url "postgresql://…"
./scripts/schema-drift.sh --extras           # also: in the database, not in the schema
```

It parses `schema.prisma` and reports what the database is missing — tables,
columns, enum types, and **enum values**, which is the case that looks like
nothing: the column and the type both exist and the insert still fails on an
unknown label. For each finding it names the migration file that creates it and
whether that file is registered with the deploy, because that is the fix:

```
  MISSING TABLES

    lead_dial_reservations        created by 20260803000000_add_lead_dial_reservations  NOT REGISTERED

  MISSING COLUMNS

    insurance_carrier_applications.voidedAt   added by 20260914000000_agent_entered_applications  (registered)
```

Exit status is 0 in sync, 1 drift, 2 could not tell — so it can gate a deploy
later rather than being run only when something is already wrong.

**It uses psql and awk, not the Prisma CLI.** Deliberately: the production host
has no `node_modules` — the API runs from an image carrying its own — and a
deploy has already died at `sh: 1: prisma: not found` with the migrations
applied and nothing shipped.

**It writes nothing.** Every statement is a SELECT and it creates no table, not
even a temporary one; expected names travel in as `VALUES` lists. Verified by
running it against a database with `default_transaction_read_only = on`, where
`CREATE TABLE` is refused: the script completes and reports correctly.

Validated against a database built by `prisma db push` from this schema — which
by construction has everything — where it reports **in sync** across 103 tables,
1,420 columns, 82 enums and 332 enum values. A parser that over-reports would
fail that immediately. Then, against a copy with a table, two columns, an enum
type and five enum values removed, it found each one, attributed each to the
right migration, and got the registered/unregistered status right in every case.

## Remediation sketch

Not done here — this is for scheduling.

1. **Make the gap visible.** Add a CI job that runs `migrate deploy` against an
   empty database. It fails today; that is the point. Until it exists, any fix
   will silently rot again.
2. **Squash.** The cleanest repair is a new baseline: diff the live schema into
   one migration, mark the existing 14 as applied on live databases with
   `prisma migrate resolve --applied`, and keep the baseline as the sole
   starting point. Prisma documents this as baselining an existing database.
3. **Then hold the line.** Once step 1 is green, `db push` should stay a
   development convenience and stop being how schema reaches an environment.

Ordering matters: doing 2 without 1 fixes it once and lets it drift again.

## How to reproduce

```bash
createdb migtest
DATABASE_URL="postgresql://.../migtest" npx prisma migrate deploy   # fails at 13/14
```
