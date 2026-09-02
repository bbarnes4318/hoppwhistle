#!/usr/bin/env bash
#
# Hopwhistle deploy — run this ON THE SERVER.
#
#   cd /opt/hopwhistle && ./deploy.sh          # pull and rebuild api, web, freeswitch
#   ./deploy.sh web                            # just the web container
#   ./deploy.sh api web                        # any subset
#
# deploy.ps1 does the same thing from a Windows PC over ssh. It is PowerShell:
# running it here gives "Permission denied", which is the shell saying it is not
# a program, not a permissions problem.

set -euo pipefail

COMPOSE="docker compose --env-file .env -f infra/docker/docker-compose.dev.yml"
BRANCH="main"
# Branch on $# rather than building an array first: under `set -u`, expanding an
# empty array is itself an error on bash before 4.4.
if [ $# -eq 0 ]; then
  SERVICES=(api web freeswitch)
else
  SERVICES=("$@")
fi

cd "$(dirname "$0")"

echo "============================================="
echo "Hopwhistle Deploy — ${SERVICES[*]}"
echo "============================================="
echo

echo ">>> Pulling $BRANCH..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"
echo "now at: $(git rev-parse --short HEAD)"
echo

echo ">>> Building..."
$COMPOSE build "${SERVICES[@]}"
echo

# --force-recreate because compose will happily leave the old container running
# against a freshly built image, and a deploy that builds but does not swap
# looks identical to one that worked.
echo ">>> Starting..."
$COMPOSE up -d --force-recreate "${SERVICES[@]}"

sleep 8
echo
for svc in "${SERVICES[@]}"; do
  docker ps --filter "name=hopwhistle-$svc-dev" --format '{{.Names}}  {{.Status}}'
done

cat <<'EOF'

Each Status above should read "Up N seconds", not hours. Hours means the
container was never swapped and you are still running the old code.

Schema changes are NOT applied here, on purpose. This database has no Prisma
migration history -- it was built with db push, so `prisma migrate deploy`
fails with P3005. Apply one deliberately instead:

  cat apps/api/prisma/migrations/<name>/migration.sql \
    | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
EOF
