#!/bin/bash
set -e

# ── Host guard ───────────────────────────────────────────────────────────────
#
# Step 4 of this script runs `prisma migrate reset --force`, which DROPS AND
# RECREATES THE ENTIRE SCHEMA. `--force` means there is no confirmation prompt.
# Run against production it destroys the production database, and the `.env` it
# loads has pointed at production before now.
#
# So the destination is checked before anything runs. Only a loopback host is
# allowed. This is deliberately strict: the compose service name `postgres`
# resolves, on the deployment host, to the production container -- so a hostname
# that LOOKS local is exactly the case that has to be refused.
#
# If you need to reset a remote database, do it deliberately and by hand. Do not
# relax this guard.

ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "REFUSING TO RUN: no $ENV_FILE to read DATABASE_URL from." >&2
  exit 1
fi

DB_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')"

if [ -z "$DB_URL" ]; then
  echo "REFUSING TO RUN: no DATABASE_URL found in $ENV_FILE." >&2
  exit 1
fi

# Strip scheme and any credentials, then take the host up to : or / -- so a
# password containing an '@' cannot smuggle a different host past this.
DB_HOST="$(printf '%s' "$DB_URL" | sed -E 's#^[a-zA-Z0-9+.-]+://##; s#^[^@/]*@##; s#[:/?].*$##')"

case "$DB_HOST" in
  localhost | 127.0.0.1 | ::1 | '[::1]')
    echo "Host guard: target is '$DB_HOST' -- local, proceeding."
    ;;
  *)
    echo "" >&2
    echo "REFUSING TO RUN." >&2
    echo "" >&2
    echo "  DATABASE_URL in $ENV_FILE points at host: '$DB_HOST'" >&2
    echo "  Only localhost, 127.0.0.1 and ::1 are permitted." >&2
    echo "" >&2
    echo "  Step 4 of this script runs 'prisma migrate reset --force', which drops" >&2
    echo "  and recreates the entire schema with no confirmation prompt. Against a" >&2
    echo "  non-local database that means destroying data that is not yours to lose." >&2
    echo "" >&2
    echo "  If you genuinely intend to reset a remote database, do it by hand and" >&2
    echo "  deliberately. Do not edit this guard out." >&2
    echo "" >&2
    exit 1
    ;;
esac

echo "=== Resetting Database Migrations ==="

# 1. Pull latest code
echo "1. Pulling latest code..."
git pull origin master

# 2. Stop API
echo "2. Stopping API..."
docker stop hopwhistle-api || true
docker rm hopwhistle-api || true

# 3. Reset the database migration state
echo "3. Resetting database migration state..."
docker run --rm \
  --network docker_default \
  --env-file .env \
  -v $(pwd)/apps/api/prisma:/app/prisma \
  -w /app \
  node:20-alpine \
  sh -c "npm install -g prisma@6.19.0 && prisma migrate resolve --rolled-back 20240101000000_add_transcripts || true && prisma migrate resolve --rolled-back 20240102000000_add_accrual_ledger || true && prisma migrate resolve --rolled-back 20240103000000_add_compliance || true && prisma migrate resolve --rolled-back 20240104000000_add_stir_shaken_cnam_carrier || true"

# 4. Drop and recreate the database schema (WARNING: THIS WILL DELETE ALL DATA)
echo "4. Resetting database schema..."
docker run --rm \
  --network docker_default \
  --env-file .env \
  -v $(pwd)/apps/api/prisma:/app/prisma \
  -w /app \
  node:20-alpine \
  sh -c "npm install -g prisma@6.19.0 && prisma migrate reset --force --skip-seed"

# 5. Rebuild API
echo "5. Rebuilding API..."
docker-compose --env-file .env \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.voice.yml \
  build --no-cache api

# 6. Start API
echo "6. Starting API..."
docker run -d \
  --name hopwhistle-api \
  --network docker_default \
  --env-file .env \
  -p 3001:3001 \
  docker_api:latest

# 7. Wait for API to be ready
echo "7. Waiting for API to start..."
sleep 5

# 8. Check API logs
echo "8. Checking API logs..."
docker logs hopwhistle-api --tail 30

# 9. Restart worker
echo "9. Restarting worker..."
docker restart hopwhistle-worker
sleep 3
docker logs hopwhistle-worker --tail 30

echo "=== Migration Reset Complete ==="
