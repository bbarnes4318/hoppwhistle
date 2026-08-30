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
- Production and CI are unaffected right now.

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
