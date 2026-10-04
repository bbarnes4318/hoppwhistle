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

# FREESWITCH_INTERNAL_KEY is required because the FreeSWITCH callbacks now fail
# closed without it. That makes a missing value an outage rather than a leak, so
# it is caught here -- before anything ships -- instead of at 3am. Generate one
# with: openssl rand -hex 32
# JWT_SECRET signs every login. The compose file used to fall back to a default
# string that is public in this repository, so a missing value meant anyone who
# read the repo could forge a session -- and nothing here checked for it.
REQUIRED="FIELD_ENCRYPTION_KEY VAPI_API_KEY TCPA_API_KEY TCPA_API_SECRET STRIPE_SECRET_KEY SIGNALWIRE_API_TOKEN DEEPSEEK_API_KEY PUBLIC_IP FREESWITCH_INTERNAL_KEY JWT_SECRET"

# --- Preflight: every required secret must be present AND non-empty in .env
miss=""
for v in $REQUIRED; do grep -qE "^${v}=.+" "$ENVF" || miss="$miss $v"; done
if [ -n "$miss" ]; then RED "REFUSED: missing/blank in $ENVF:$miss"; exit 1; fi
if grep -qE "^JWT_SECRET=dev-secret-change-in-production\s*$" "$ENVF"; then
  RED "REFUSED: JWT_SECRET in $ENVF is the public default. Replace it with: openssl rand -hex 32"; exit 1
fi
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

if docker exec hopwhistle-api-dev printenv JWT_SECRET 2>/dev/null | grep -qx "dev-secret-change-in-production"; then
  RED "DEPLOY FAILED VERIFICATION - the API is signing logins with the public default JWT_SECRET."
  exit 2
fi

# --- Postflight: FreeSWITCH and the API must hold the SAME internal key.
# FreeSWITCH presents it on every directory lookup (every agent registration)
# and every inbound route lookup. A mismatch is not visible anywhere except as
# every softphone getting "403 Forbidden" and every inbound call failing, which
# is how the 2026-10-04 outage looked. This compares the key FreeSWITCH is
# actually using (its runtime variable, not its container environment) with
# the API's, and never prints either.
if docker ps --format '{{.Names}}' | grep -qx hopwhistle-freeswitch-dev; then
  fs_ready=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if docker exec hopwhistle-freeswitch-dev fs_cli -x "status" >/dev/null 2>&1; then fs_ready=1; break; fi
    sleep 3
  done
  if [ -z "$fs_ready" ]; then
    RED "WARNING: FreeSWITCH did not answer fs_cli; could not verify the internal key."
  else
    api_key="$(docker exec hopwhistle-api-dev printenv FREESWITCH_INTERNAL_KEY 2>/dev/null | tr -d '[:space:]')"
    fs_key="$(docker exec hopwhistle-freeswitch-dev fs_cli -x "global_getvar internal_key" 2>/dev/null | tr -d '[:space:]')"
    if [ -z "$fs_key" ] || [ "$api_key" != "$fs_key" ]; then
      RED "DEPLOY FAILED VERIFICATION - FreeSWITCH and the API hold DIFFERENT internal keys."
      RED "Every softphone will get 403 Forbidden and inbound calls will fail."
      if [ -n "$(git -C "$ROOT" status --porcelain -- infra/docker apps/freeswitch 2>/dev/null)" ]; then
        RED "This server has local edits to the compose/FreeSWITCH files, which can give FreeSWITCH its own value:"
        git -C "$ROOT" status --short -- infra/docker apps/freeswitch >&2
      fi
      RED "If FreeSWITCH was not part of this deploy, run: scripts/deploy.sh api freeswitch"
      exit 4
    fi
    GRN "postflight ok: FreeSWITCH and the API hold the same internal key"
  fi
fi

# --- Postflight: a FreeSWITCH restart can strand a carrier on a stale UDP
# conntrack entry, so its calls never reach the new container. Clear any.
# See scripts/sip-conntrack.sh. Non-fatal: a failure here is reported, not a
# reason to fail an otherwise good deploy.
case " $SVCS " in
  *" freeswitch "*)
    "$ROOT/scripts/sip-conntrack.sh" --fix || RED "WARNING: could not check SIP conntrack entries (see above)"
    ;;
esac

# --- Postflight: database identity must not drift
VOL="$(docker inspect hopwhistle-postgres-dev --format "{{range .Mounts}}{{.Name}}{{end}}" 2>/dev/null || true)"
if [ "$VOL" != "docker_postgres_data" ]; then
  RED "DATABASE DRIFT: postgres is on volume \"$VOL\", expected docker_postgres_data"; exit 3
fi
GRN "postflight ok: database on docker_postgres_data"

# --- Housekeeping: old rollback/candidate images piled up and filled the disk. Non-fatal.
"$ROOT/scripts/prune-docker-images.sh" --apply || RED "image prune failed (non-fatal)"
GRN "deploy complete"
