# "All the calls are gone" — what it actually was

**Reported:** the admin portal showed 3,949 calls for Test Organization against
an expected 70,000+, and the AI voice calls and recordings that used to appear
were not there.

**Resolved:** nothing was lost. The calls being looked for are **Dograh AI voice
calls**, they are in Dograh's own database — 110,723 runs as of 2026-09-10,
still recording — and they stopped being visible because the portal moved
domains and the embedded app's sign-in broke. See
[`AIVOICE_DOMAIN_MOVE.md`](AIVOICE_DOMAIN_MOVE.md) for the cause and the fix.

This document is kept for the two things the investigation turned up that are
true and worth acting on regardless, and for an honest record of a wrong turn.

---

## The wrong turn, recorded

The first two versions of this document said the missing calls were Hopwhistle
calls that had been left behind — first on the AWS host, then in a second
PostgreSQL data directory on the Hetzner host. **Both were wrong**, and the
second was disproved in one command:

```
$ docker volume ls | grep -i postgres
local     docker_postgres_data      # the portal's — the volume deploy.sh expects
local     dograh_postgres_data      # Dograh's
```

Two volumes, no stranded twin, no drift. The reasoning that produced that theory
was sound about the portal's database and simply answering a question nobody had
asked: the calls the owner meant were never in that database at all.

The lesson worth keeping: **"my calls are missing" does not identify a system.**
This platform has two call stores, and the portal shows one of them. Ask which
kind of call before reasoning about where rows went.

## Finding 1 — the AI voice calls were never in the Hopwhistle database

Dograh is a separate application at `/opt/dograh`, with its own PostgreSQL and
its own recording storage. From `deploy/dograh/export_recordings.py`:

> Dograh owns its own database and recording storage; nothing about these calls
> lands in the Hopwhistle DB.

The portal displayed them by **embedding** the Dograh app in an iframe at
`/voice-agents`, signed in with a cookie minted by
`apps/api/src/routes/aivoice.ts`. When the portal moved from `hopwhistle.com` to
`agents.netenroll.com`, that cookie stopped reaching the frame — the two are no
longer on one registrable domain — so the iframe started showing Dograh's own
login instead of the calls, silently. `AIVOICE_DOMAIN_MOVE.md` has the browser
rules, the fix, and the runbook.

To get the calls and audio out today, independent of any of that:

```bash
cd /opt/hopwhistle
./get-dograh-recordings.sh 2025-09-10 2026-09-10
```

## Finding 2 — the portal's own database was seeded, not restored

Unrelated to the report, still true, and worth knowing.

The stack moved from AWS to Hetzner. `HETZNER_MIGRATION_FROM_AWS.md` names the
AWS `callfabric` database "the single source of truth" and has a `pg_dump` step
(2.2) and a `pg_restore` step (2.5). Neither appears to have run:

- **`HETZNER_DEPLOYMENT_VALIDATION.md` § 20** — the final cutover checklist is
  still unchecked: "Confirm AWS database dump completed successfully", "Confirm
  AWS recordings sync completed successfully", "Confirm Hetzner database restore
  completed successfully".
- **`hetzner_validation_report.md`** signs the migration off as fully verified,
  and its one database line is a **seed**: "Generated Tenant, Roles, Carrier,
  Trunk, Flow/IVR, Webhook, and Feature Flags." No calls, no recordings, no CDRs.
- **`walkthrough.md` § 8** records `prisma db push --force-reset` against the
  fresh container, then `prisma db seed`, then the health check that read:
  **"PostgreSQL: Succeeded (database table count check `calls` = 1)."**

`prisma/seed.ts:12` creates a tenant named `Test Organization`, slug `test-org` —
which is why that is the agency the portal shows. Its 3,949 calls are the
platform's own pay-per-call traffic since the cutover: real calls, correctly
recorded, in a database that started empty.

Whether any pre-cutover Hopwhistle call history existed and is worth recovering
is a question for the owner. If it is, the tooling below reads and moves it
safely. If it is not, nothing here needs doing.

## The tooling, and what it is good for

Built during this investigation. All of it works; none of it was needed in the
end, and it is here for the next time a database question comes up.

| Command | What it does |
| --- | --- |
| `calls:diagnose --email <you>` | Why is *my* portal empty? Resolves the acting tenant, roles and links the way the API does, replays the portal's own query, and names which of five causes it is. Read-only. |
| `calls:inventory [--url …]` | What call history does *this* database hold? Works against any database, including one older than the current schema — it reads `information_schema` rather than using the Prisma client. Read-only. |
| `calls:restore --from … --into-tenant …` | Copies calls, recordings, CDRs, legs and transcripts from another database into the live one. Dry run until `--commit`; inserts only, always `ON CONFLICT DO NOTHING`. |
| `scripts/find-call-history.sh` | Which PostgreSQL data directory on this host holds call history? Covers detached volumes by copying them and reading the copy — never starts a server on your volume. |

Verified against real PostgreSQL 16: the restore moved 250,000 rows in 30
seconds preserving ids, numbers, durations and dates; the detached-volume read
returned correct counts from a cluster behind an unknown password and left the
original byte-for-byte identical.

## What should change either way

1. **A cutover was signed off against liveness, not data.** Every check in the
   validation report is "the service answers". The one line that touched data —
   `calls = 1` — was recorded as a success. A cutover checklist needs a row count
   from the old host and the same row count on the new one, as a blocking check.

2. **`--force-reset` and `--accept-data-loss` are in the documented deploy
   path.** `docs/QUICK_REFERENCE.md`, `docs/AI_CONTEXT_PROMPT.md`,
   `.agent/workflows/deploy.md` and `docs/COMPLETE_DISCLOSURE.md` all end their
   deploy sequence with `prisma db push --accept-data-loss` against production.
   `deploy.ps1` already refuses and explains why; the other four still tell a
   reader to do it. They should be changed to match.

3. **`reset-migrations.sh` runs `prisma migrate reset --force`** against whatever
   `.env` points at, under a comment saying it will delete all data. On the
   production host that is the production database. It should refuse without an
   explicit confirmation naming the database.

4. **There are no verified backups.** `docs/BACKUP_RESTORE.md` describes a
   six-hourly schedule with 30-day retention; nothing in the repository installs,
   runs or monitors it.

5. **The portal cannot show two kinds of call.** The AI voice calls live in
   another system and are visible only through an embedded app, which is why one
   domain change made them vanish with no error anywhere. Syncing Dograh's
   `workflow_runs` into `Call` and `Recording` rows would put both kinds in one
   ledger, filterable and exportable together, and would survive the next move.
   Not done; worth doing.
