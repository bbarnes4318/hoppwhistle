#!/usr/bin/env bash
# Sanctioned deploy for hopwhistle. Encodes the fixes for the 2026-08-16 outage.
# Usage: scripts/deploy.sh [--build] [service ...]      (default services: api web)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV="$ROOT/infra/docker/docker-compose.dev.yml"
ENVF="$ROOT/.env"
RED() { printf "\033[31m%s\033[0m\n" "$*" >&2; }
GRN() { printf "\033[32m%s\033[0m\n" "$*"; }

# --- Guard 1: refuse the base compose file (inverted minio/clickhouse port maps -> 9000/9002 collision)
for a in "${@:-}"; do
  case "$a" in
    *docker-compose.yml*) RED "REFUSED: base docker-compose.yml collides with the dev file on ports 9000 and 9002."; exit 1 ;;
    --remove-orphans)     RED "REFUSED: --remove-orphans would destroy hopwhistle-dialer-v2."; exit 1 ;;
  esac
done

# --- Guard 2: env file sanity
[ -s "$ENVF" ] || { RED "REFUSED: $ENVF is missing or empty."; exit 1; }

REQUIRED="FIELD_ENCRYPTION_KEY VAPI_API_KEY TCPA_API_KEY TCPA_API_SECRET STRIPE_SECRET_KEY SIGNALWIRE_API_TOKEN DEEPSEEK_API_KEY PUBLIC_IP"

# --- Preflight: every required secret must be present AND non-empty in .env
miss=""
for v in $REQUIRED; do grep -qE "^${v}=.+" "$ENVF" || miss="$miss $v"; done
if [ -n "$miss" ]; then RED "REFUSED: missing/blank in $ENVF:$miss"; exit 1; fi
GRN "preflight ok: all required secrets present in .env"

# --- Deploy (always dev file only, always explicit --env-file, CWD-independent)
SVCS="${*:-api web}"
BUILD=""
case "$SVCS" in *--build*) BUILD="--build"; SVCS="${SVCS//--build/}" ;; esac
[ -n "${SVCS// /}" ] || SVCS="api web"
echo "deploying: $SVCS ${BUILD}"
docker compose --env-file "$ENVF" -f "$DEV" up -d $BUILD $SVCS

# --- Postflight: assert the secrets actually landed in the running container
sleep 3
fail=""
for v in $REQUIRED; do
  val="$(docker exec hopwhistle-api-dev printenv "$v" 2>/dev/null || true)"
  [ -n "$val" ] || fail="$fail $v"
done
if [ -n "$fail" ]; then
  RED "DEPLOY FAILED VERIFICATION - blank in running container:$fail"
  RED "The API is running WITHOUT credentials. Investigate before trusting it."
  exit 2
fi
GRN "postflight ok: all required secrets present in hopwhistle-api-dev"

# --- Postflight: database identity must not drift
VOL="$(docker inspect hopwhistle-postgres-dev --format "{{range .Mounts}}{{.Name}}{{end}}" 2>/dev/null || true)"
if [ "$VOL" != "docker_postgres_data" ]; then
  RED "DATABASE DRIFT: postgres is on volume \"$VOL\", expected docker_postgres_data"; exit 3
fi
GRN "postflight ok: database on docker_postgres_data"
GRN "deploy complete"
