#!/usr/bin/env bash
# Rotate FREESWITCH_INTERNAL_KEY: the shared secret FreeSWITCH presents to the
# API on every agent registration and every inbound call lookup.
#
# One command, nothing to edit by hand:
#   scripts/rotate-freeswitch-key.sh
#
# It writes a new key into .env (keeping a dated backup), redeploys the API and
# FreeSWITCH together through scripts/deploy.sh -- they must change in the same
# step, or every softphone gets 403 Forbidden -- and deploy.sh then proves both
# sides hold the same key. Restarting FreeSWITCH drops calls in progress, so
# run it when nobody is on the phone.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVF="$ROOT/.env"
RED() { printf "\033[31m%s\033[0m\n" "$*" >&2; }
GRN() { printf "\033[32m%s\033[0m\n" "$*"; }

[ -s "$ENVF" ] || { RED "REFUSED: $ENVF is missing or empty."; exit 1; }
command -v openssl >/dev/null || { RED "REFUSED: openssl is not installed."; exit 1; }

backup="$ENVF.bak.$(date +%Y%m%d-%H%M%S)"
cp -p "$ENVF" "$backup"
new_key="$(openssl rand -hex 32)"

if grep -qE "^FREESWITCH_INTERNAL_KEY=" "$ENVF"; then
  # Replace in place. The key is hex, so it needs no escaping in sed.
  sed -i -E "s|^FREESWITCH_INTERNAL_KEY=.*$|FREESWITCH_INTERNAL_KEY=${new_key}|" "$ENVF"
else
  printf '\nFREESWITCH_INTERNAL_KEY=%s\n' "$new_key" >> "$ENVF"
fi
GRN "new FREESWITCH_INTERNAL_KEY written to .env (previous file saved as $(basename "$backup"))"

if ! "$ROOT/scripts/deploy.sh" api freeswitch; then
  RED "Deploy failed. Restoring the previous .env and redeploying with the old key."
  cp -p "$backup" "$ENVF"
  "$ROOT/scripts/deploy.sh" api freeswitch || true
  exit 1
fi
GRN "rotation complete: agents will re-register on their own within a minute"
