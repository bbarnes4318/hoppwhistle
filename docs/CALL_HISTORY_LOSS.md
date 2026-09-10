# The missing call history

**Status:** the live database does not contain the platform's call history, and
never did. The rows were not deleted from it — they were never copied into it.

**Reported:** the admin portal shows 3,949 calls for Test Organization against
an expected 70,000+.

**What this document is:** where the history is, the evidence that it is there,
and how to put it back. It is written to be checked rather than believed —
every claim below names the file or the command that establishes it.

---

## What happened

The stack moved from AWS to Hetzner. The migration playbook
(`HETZNER_MIGRATION_FROM_AWS.md`) is explicit that the AWS PostgreSQL database
`callfabric` is "**the single source of truth for database and media
migration**", and its steps 2.2 and 2.5 are a `pg_dump` of that database and a
`pg_restore` of it onto the new host.

Those two steps do not appear to have been carried out.

**The final cutover checklist is unchecked.**
`HETZNER_DEPLOYMENT_VALIDATION.md` § 20:

```
- [ ] Confirm AWS database dump completed successfully.
- [ ] Confirm AWS recordings sync completed successfully.
- [ ] Confirm Hetzner database restore completed successfully.
```

**The validation report records a seed where a restore should be.**
`hetzner_validation_report.md` reports the migration as fully verified, and its
database line is:

> **F. Database Seed** | Populate validation data | **PASSED** | Database
> seeding (`tsx prisma/seed.ts`) completed successfully. Generated Tenant,
> Roles, Carrier, Trunk, Flow/IVR, Webhook, and Feature Flags

Tenants, roles and feature flags. No calls, no recordings, no CDRs.

**The new database was force-reset and seeded.** `walkthrough.md` § 8:

> Aligned database schemas on the fresh PostgreSQL container using
> `npx prisma db push --force-reset --skip-generate` to synchronize schema
> models. Successfully seeded the database using `npx prisma db seed` …

`--force-reset` drops the database and recreates it empty. Anything restored
before it ran would not have survived it.

**And the validation line says so outright.** From the same section, under service
health:

> **PostgreSQL**: Succeeded (database table count check `calls` = 1).

The stack was signed off as healthy with **one** call row in it.

**Which is why the tenant is called Test Organization.** `prisma/seed.ts` line
12 creates a tenant named `Test Organization` with slug `test-org`. That is a
seed fixture, and it is the agency the portal has been showing. The 3,949 calls
in it are the traffic that has arrived since the cutover — real calls, correctly
recorded, in a database that started empty.

The host `.env` was repointed at the same time (`walkthrough.md` § 8), from the
AWS endpoints to local Hetzner containers:

```
DATABASE_URL -> postgresql://callfabric:callfabric_dev@postgres:5432/callfabric
S3_ENDPOINT  -> http://minio:9000
```

So the application stopped reading the database that holds the history, and
started reading a new, empty one beside it. Nothing deleted the old data. The
old data was left where it was.

## Where the history is

| What | Where | Per |
| --- | --- | --- |
| Calls, CDRs, legs, transcripts | AWS EC2, container `hopwhistle-postgres-dev`, database `callfabric`, user `callfabric` | `HETZNER_MIGRATION_FROM_AWS.md` § 1 |
| Recordings | AWS S3 bucket `hopwhistle-recordings-prod` | `HETZNER_MIGRATION_FROM_AWS.md` § 2.3 |
| Analytics CDRs | the pre-cutover ClickHouse (the `.env` scrub replaced its URL) | `walkthrough.md` § 8 |

The Vultr host is explicitly **not** a source — the playbook says to treat it as
historical and to migrate nothing from it.

## Recovering it

### 0. Before anything else

**Do not terminate, stop, resize or reimage the AWS instance, and do not delete
the S3 bucket.** Take a snapshot of the EBS volume now. Until the restore is
verified, that instance is the only copy of the history.

### 1. Confirm it is there

```bash
pnpm --filter @hopwhistle/api calls:inventory -- \
  --url "postgresql://callfabric:PASSWORD@AWS_HOST:5432/callfabric"
```

Reads only. Prints row counts for calls, CDRs, legs, recordings and
transcriptions, and calls per tenant with first and last dates. This is the
number that either confirms 70,000 or tells you the AWS database is not the
right source either. **Run it before planning anything else.**

Run it against the live database too, for the before-side of the comparison:

```bash
pnpm --filter @hopwhistle/api calls:inventory
```

### 2. Restore the old database into its OWN database

```bash
# On AWS
docker exec -t hopwhistle-postgres-dev \
  pg_dump -U callfabric -d callfabric -F c -b -v -f /tmp/callfabric_backup.dump
docker cp hopwhistle-postgres-dev:/tmp/callfabric_backup.dump ./callfabric_backup.dump

# On Hetzner — note the database name. NOT callfabric.
createdb -U callfabric callfabric_legacy
pg_restore -U callfabric -d callfabric_legacy -v callfabric_backup.dump
```

**Never restore the dump over the live `callfabric` database.** The live one
holds every call since the cutover, and those exist nowhere else. Restoring on
top of it would destroy the only records this procedure cannot recover.

### 3. Copy the history into the live database

```bash
# Which agency should own it? The live database's agencies:
pnpm --filter @hopwhistle/api calls:inventory

# Dry run. Writes nothing.
pnpm --filter @hopwhistle/api calls:restore -- \
  --from "postgresql://callfabric:PASSWORD@localhost:5432/callfabric_legacy" \
  --into-tenant <the agency id>

# Then, once the dry run's numbers look right:
pnpm --filter @hopwhistle/api calls:restore -- \
  --from "postgresql://callfabric:PASSWORD@localhost:5432/callfabric_legacy" \
  --into-tenant <the agency id> --commit
```

The command inserts and never updates or deletes; every insert carries `ON
CONFLICT DO NOTHING`, so it is safe to re-run and safe to interrupt. It copies
the columns the two schemas share, so the older source schema is not a problem.
A call whose campaign, publisher, buyer, number or creating user does not exist
in the live database keeps the call and nulls the reference — the record is
worth more than the link. See the header of
`apps/api/src/cli/restore-call-history.ts`.

### 4. Verify

```bash
pnpm --filter @hopwhistle/api calls:inventory
```

Calls, recordings, CDRs and legs should have risen by what step 1 reported on
the source. Then open the portal.

### 5. The recordings themselves

The rows restored in step 3 carry storage keys pointing at
`hopwhistle-recordings-prod`. The audio still has to be copied, per
`HETZNER_MIGRATION_FROM_AWS.md` § 2.3 — and note that the MinIO bucket created
during the cutover is named `hopwhistle-recordings`, not
`hopwhistle-recordings-prod`, so check which name the running configuration
expects before syncing.

## What made this possible, and what should change

1. **The cutover was signed off against health checks, not against data.** Every
   check in the validation report is a liveness check: the API answers, Redis
   returns PONG, ClickHouse says Ok. The one line that touched the data —
   `calls = 1` — was recorded as a success. A cutover checklist needs a row
   count from the old host and the same row count on the new one, and it needs
   to be the check that blocks.

2. **`--force-reset` and `--accept-data-loss` are in the documented deploy
   path.** `docs/QUICK_REFERENCE.md`, `docs/AI_CONTEXT_PROMPT.md`,
   `.agent/workflows/deploy.md` and `docs/COMPLETE_DISCLOSURE.md` all end their
   deploy sequence with `prisma db push --accept-data-loss` against production.
   `deploy.ps1` already refuses to do this and explains why; the other four
   still tell a reader to. They should be changed to match.

3. **`reset-migrations.sh` runs `prisma migrate reset --force` against whatever
   `.env` points at**, under a comment that says it will delete all data. On the
   production host that is the production database. It should refuse to run
   without an explicit confirmation naming the database.

4. **There are no verified backups.** `docs/BACKUP_RESTORE.md` describes a
   six-hourly schedule with 30-day retention; nothing in the repository
   installs, runs or monitors it. If it had been running, this would have been
   an hour's work rather than an investigation.
