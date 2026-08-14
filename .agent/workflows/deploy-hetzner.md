---
description: How to deploy the Hopwhistle platform to the Hetzner production host
---

# Hopwhistle Deployment (Hetzner)

Replaces `.agent/workflows/deploy.md`, which was deleted. That file documented the AWS
host, and the AWS→Hetzner migration has completed: `3.214.60.13` no longer answers on
ssh, postgres or the API port. It also carried a plaintext database password, wrong
container names and a dead SSH key path. It was stale in its entirety, not repairable
line by line.

## Credentials are not in this file, and must not be added to it

Every secret comes from `/opt/hopwhistle/.env` **on the server**, which is gitignored and
never committed. If you need a value, read it there. Do not paste one into this document
or any other file in the repository.

## The environment

|              |                                                                                      |
| ------------ | ------------------------------------------------------------------------------------ |
| Host         | `178.156.223.97` (Hetzner)                                                           |
| User         | `root`                                                                               |
| SSH key      | `~/.ssh/hetzner_pvn` (path only — the key itself is not in the repo)                 |
| Project path | `/opt/hopwhistle`                                                                    |
| Compose file | `infra/docker/docker-compose.dev.yml`                                                |
| Database     | `callfabric` — **the only database that exists.** There is no `hopwhistle` database. |

Container names — these are the real ones, and they end in `-dev` despite being production:

| Service    | Container                   |
| ---------- | --------------------------- |
| API        | `hopwhistle-api-dev`        |
| Web        | `hopwhistle-web-dev`        |
| PostgreSQL | `hopwhistle-postgres-dev`   |
| Redis      | `hopwhistle-redis-dev`      |
| FreeSWITCH | `hopwhistle-freeswitch-dev` |

`DATABASE_URL` is built by the compose file as
`postgresql://<user>:<pass>@postgres:5432/${POSTGRES_DB:-callfabric}`. **That is the only
source.** Do not set `DATABASE_URL` in `apps/api/.env` or `apps/worker/.env.local` —
`dotenv-flow` will not override a variable compose has already set, so a value there is
ignored inside the container and used everywhere else, which is the worst of both.

## Deploying

`deploy.ps1` at the repository root is the deployment path. It SSHes to the host, pulls,
rebuilds `api web freeswitch` with `--no-cache`, restarts the stack and aligns the schema.

```bash
pwsh ./deploy.ps1
```

> ⚠️ **`deploy.ps1` deploys the branch `edit-campaign-buyer-fix`, not `main`.** That is
> what the script does today, stated here because it is surprising and easy to miss.
> Check it before assuming a deploy shipped what is on `main`.

### Always build with `--no-cache`

Docker layer caching silently skips code changes. `deploy.ps1` already passes it; if you
build by hand, pass it too.

## The schema step

```bash
docker exec -u root hopwhistle-api-dev npx prisma db push
```

**Never add `--accept-data-loss`.** Without it, `db push` refuses any change that would
destroy data and stops. A refusal is the safety mechanism working: it means the diff
Prisma computed would drop a column, a table or an index from a database holding call
records and lead data.

**If it refuses: stop and find out what it wants to drop.** Do not add the flag to make it
proceed. `deploy.ps1` joins its remote commands with `&&`, so a refusal halts the deploy —
a stopped deploy is recoverable, dropped rows are not.

Ignore `EACCES` errors from `prisma generate`; they are unrelated to the schema.

### Why this is still `db push` and not a migration

Production has never been managed by Prisma Migrate — there is no `_prisma_migrations`
table, and `prisma migrate deploy` from empty fails at
`20260721_add_call_contact_relation`. Baselining is planned but not done. Until it is,
`db push` without the destructive flag is the least-bad option, not a good one.

## Verifying a deploy

```bash
curl -s http://localhost:3001/health/ready
```

**Use `/health/ready`, not `/health`.** `/health` returns `{"status":"ok"}`
unconditionally — it is a static object that never touches the database, so it cannot
fail and therefore verifies nothing. `/health/ready` actually queries PostgreSQL, Redis
and ClickHouse, and returns a non-200 when a dependency is down.

A healthy response reports `"status":"healthy"` with `checks.database.status: "ok"`.

## Rolling back

There is no automated rollback. Redeploy the previous commit, and if the schema changed,
be aware `db push` will attempt to sync backwards — which is exactly the case where it
will refuse. That refusal is correct; restore from backup rather than forcing it.
