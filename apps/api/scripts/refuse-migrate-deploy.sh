#!/usr/bin/env bash
# `prisma migrate deploy` is not how this database is migrated. Refuse, loudly,
# and say what to run instead.
#
# This replaces the `db:migrate:deploy` package script rather than deleting it.
# Deleting it makes `pnpm --filter @hopwhistle/api db:migrate:deploy` print
# "None of the selected packages has a 'db:migrate:deploy' script", which reads
# like a typo and invites the reader to reach for `prisma migrate deploy`
# directly -- the exact command this exists to prevent.
set -euo pipefail

cat >&2 <<'WHY'

REFUSED: `prisma migrate deploy` must not be run against this database.

  There is no _prisma_migrations table. This database has never been managed by
  prisma migrate. Every migration to date was applied by piping its
  migration.sql into psql by hand.

  `migrate deploy` reads that empty history as "nothing has been applied" and
  tries to replay every migration in the repository from the beginning, against
  a schema where those objects already exist. It would not get far: a replay
  from scratch dies at migration 12 of 14 regardless, because the history
  references tables that no migration creates.

  See docs/MIGRATION_DIVERGENCE.md for the measurements.

WHAT TO RUN INSTEAD

  Deploying:      scripts/deploy-netenroll.sh
                  Step 2 applies the named migration files through psql, in
                  order, verifying each and stopping on the first error.

  One migration:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
                    -f apps/api/prisma/migrations/<name>/migration.sql

  A fresh dev DB: pnpm --filter @hopwhistle/api db:push
                  (which is what both CI workflows use, for this same reason)

WHY
exit 1
