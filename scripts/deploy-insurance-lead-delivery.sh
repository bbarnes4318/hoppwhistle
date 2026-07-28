#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/hopwhistle}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env}"
COMPOSE_DIR="$REPO_DIR/infra/docker"
BASE_COMPOSE="$COMPOSE_DIR/docker-compose.dev.yml"
DELIVERY_COMPOSE="$COMPOSE_DIR/docker-compose.insurance-delivery.yml"
API_CONTAINER="${API_CONTAINER:-hopwhistle-api-dev}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Environment file not found: $ENV_FILE" >&2
  exit 1
fi

if ! grep -Eq '^AMERIQUOTE_API_KEY=.+$' "$ENV_FILE"; then
  echo "ERROR: AMERIQUOTE_API_KEY is missing or blank in $ENV_FILE" >&2
  exit 1
fi

if ! grep -Eq '^INSURANCE_LEAD_MODE=' "$ENV_FILE"; then
  echo 'INSURANCE_LEAD_MODE=test' >> "$ENV_FILE"
  echo "Added safe default INSURANCE_LEAD_MODE=test to $ENV_FILE"
fi

cd "$REPO_DIR"
git pull --ff-only origin main

cd "$COMPOSE_DIR"
COMPOSE=(docker compose -f "$BASE_COMPOSE" -f "$DELIVERY_COMPOSE" --env-file "$ENV_FILE")

# Always rebuild without cache so the restored delivery code is included.
"${COMPOSE[@]}" build api --no-cache
"${COMPOSE[@]}" up -d api

# Verify the non-secret runtime configuration reached the container.
docker exec "$API_CONTAINER" sh -lc '
  test -n "$AMERIQUOTE_API_KEY"
  printf "INSURANCE_LEAD_MODE=%s\n" "${INSURANCE_LEAD_MODE:-missing}"
  printf "AMERIQUOTE_API_KEY_CONFIGURED=yes\n"
  printf "AMERIQUOTE_ACA_SRC=%s\n" "${AMERIQUOTE_ACA_SRC:-missing}"
  printf "AMERIQUOTE_FE_SRC=%s\n" "${AMERIQUOTE_FE_SRC:-missing}"
'

curl -fsS http://127.0.0.1:3001/health >/dev/null
printf 'Hopwhistle API rebuilt successfully with insurance lead delivery enabled.\n'
