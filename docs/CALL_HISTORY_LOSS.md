# The missing call history

**Status:** the live database does not contain the platform's call history, and
never did. The rows were not deleted from it — it was created empty, beside the
data directory that already held them.

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

Those two steps do not appear to have been carried out. That is the origin of
the empty database, but it is **not** where to go looking: the owner confirms
nothing remains on the AWS side. The surviving copy is on the Hetzner host —
see "Where the history is" below, and start with step 1 of the recovery.

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

**On this host, in a different PostgreSQL data directory.** The owner confirms
nothing is left on AWS, and the evidence on the Hetzner side points the same
way: the application is reading one database while another one, with the
history in it, sits beside it.

**Two different database hostnames are documented for the same host.**

| Source | `DATABASE_URL` |
| --- | --- |
| `.agent/workflows/deploy.md` § Database | `…@hopwhistle-postgres-dev:5432/callfabric` |
| `hetzner_validation_report.md`, `walkthrough.md` § 8 | `…@postgres:5432/callfabric` |

`postgres` is the compose *service* name; `hopwhistle-postgres-dev` is the
`container_name` that `docker-compose.dev.yml` gives it. They resolve to the
same container only while that container is attached to `docker_default` with
that alias — which is exactly why the deploy runbook has to keep running
`docker network connect docker_default hopwhistle-postgres-dev`, and why its
troubleshooting section has an entry for `ENOTFOUND postgres`.

**`docker-compose.yml` — the file the documented deploy uses — has no
`postgres` service and no `postgres_data` volume at all.** Only
`docker-compose.dev.yml` defines them. A `docker compose up` from a different
directory or under a different project name therefore creates a *new* volume
(`<project>_postgres_data`) with an empty database, and the old volume keeps
every row.

**And `scripts/deploy.sh` already guards against precisely this:**

```sh
VOL="$(docker inspect hopwhistle-postgres-dev --format "{{range .Mounts}}{{.Name}}{{end}}")"
if [ "$VOL" != "docker_postgres_data" ]; then
  RED "DATABASE DRIFT: postgres is on volume \"$VOL\", expected docker_postgres_data"; exit 3
fi
```

That check was written because the container has come up on the wrong volume
before. A container on the wrong volume presents exactly as "all the data is
gone".

## Recovering it

### 1. Find which data directory holds it

```bash
sudo ./scripts/find-call-history.sh
```

Run it on the Hetzner host. It inspects **every** PostgreSQL data directory on
the machine — running containers and detached volumes alike — and prints the
call count, recording count and date range in each, ranked. The top row is the
one holding the history.

It does not modify your data. Running containers are queried in place with
`SELECT count(*)`. A detached volume cannot be read without a server, and
starting PostgreSQL on a data directory writes to it, so the script never does
that: it mounts the volume **read-only**, copies it to a scratch volume, starts
a throwaway server on the *copy* (with trust auth patched into the copy, since
the old cluster's password is not knowable), reads it, and deletes the copy.

That copy-then-read procedure was verified against a real PostgreSQL 16 cluster
holding 70,000 calls and 40,000 recordings, with md5 auth and an unknown
password: the counts and date range came back, and the original data directory
was byte-for-byte identical afterwards.

### 2. Do not repoint the application at it

It is tempting to change `DATABASE_URL` to the volume that has the history. Do
not. The database the application reads now holds **every call since it was put
into service**, and those rows exist nowhere else. Switching to the other volume
trades one set of missing calls for another.

Copy the history into the live database instead, and keep both.

### 3. Copy the history across

```bash
# What does the live database hold, and what agencies are in it?
pnpm --filter @hopwhistle/api calls:inventory

# What does the other one hold?
pnpm --filter @hopwhistle/api calls:inventory -- --url "postgresql://…other…"

# Dry run — writes nothing.
pnpm --filter @hopwhistle/api calls:restore -- \
  --from "postgresql://…other…" --into-tenant <the agency id>

# Then, once the dry run's numbers look right:
pnpm --filter @hopwhistle/api calls:restore -- \
  --from "postgresql://…other…" --into-tenant <the agency id> --commit
```

To reach a detached volume with `calls:inventory`, start a container on a copy
of it — the same way `find-call-history.sh` does — and point the URL at that.

`calls:restore` inserts and never updates or deletes; every insert carries `ON
CONFLICT DO NOTHING`, so it is safe to re-run and safe to interrupt. It copies
the columns the two schemas share, so an older source schema is not a problem.
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

Recording rows carry a storage key, not the audio. Once the rows are back,
check that the object store the application is configured for actually holds
the files those keys name — the cutover created a MinIO bucket called
`hopwhistle-recordings`, while `HETZNER_MIGRATION_FROM_AWS.md` § 2.3 names the
source bucket `hopwhistle-recordings-prod`. If the audio is in a different
bucket or a different volume on this host, the same principle applies: find it
before changing any configuration that points at it.

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
