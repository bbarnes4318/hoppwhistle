#!/usr/bin/env bash
#
# AI callbacks — run this ON THE SERVER, from /opt/hopwhistle.
#
#   ./setup-ai-callbacks.sh 15            # dry run: shows what would change
#   ./setup-ai-callbacks.sh 15 --apply    # do it
#   ./setup-ai-callbacks.sh 15 --rollback # undo: callbacks use their old routes again
#
# A lead who calls back one of the numbers the AI dials out from is answered by
# Dograh agent <id> (e.g. 15, "Final Expense - Alex (Inbound Callback Live
# Transfer)") instead of ringing whoever that number is routed to. Every number
# in the AI's caller-ID pool moves to that agent, including numbers another
# Dograh agent answered before.
#
# Steps (see deploy/dograh/inbound-callback/README.md):
#   1. Dograh: the agent answers the caller-ID numbers; Asterisk accepts the
#      calls from FreeSWITCH and hands them to Dograh.
#   2. DOGRAH_CALLBACK_BRIDGE in .env, then the API is rebuilt and restarted.
#   3. Hopwhistle marks exactly the numbers Dograh answers (metadata.dograhCallback).
#   4. inbound_route.lua copied into FreeSWITCH (next call, nothing dropped).
#
#   FS_CONTAINER=<name>   FreeSWITCH container (default hopwhistle-freeswitch-dev)
#   API_CONTAINER=<name>  Hopwhistle API container (default hopwhistle-api-dev)

set -euo pipefail

AGENT="${1:-}"
MODE="${2:-}"
if ! [[ "$AGENT" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 <dograh-agent-id> [--apply|--rollback]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVF="$ROOT/.env"
FS_CONTAINER="${FS_CONTAINER:-hopwhistle-freeswitch-dev}"
API_CONTAINER="${API_CONTAINER:-hopwhistle-api-dev}"
NUMBERS="$(mktemp)"
trap 'rm -f "$NUMBERS"' EXIT
INSTALLER="$ROOT/deploy/dograh/inbound-callback/install_inbound_callback.py"
# All callbacks go to the one agent: also move numbers another agent has.
INSTALL_ARGS=(--agent-id "$AGENT" --env-file "$ENVF" --replace)

set_env() {  # set_env KEY VALUE  (VALUE empty: remove KEY)
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENVF" > "$tmp" || true
  [ -n "$value" ] && printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENVF"   # same inode
  rm -f "$tmp"
}

mark_numbers() {  # mark_numbers [--apply]  — from $NUMBERS, in the API container
  # Fed on stdin: a copied file keeps root's owner and 0600 mode, which the
  # API container's non-root user cannot read.
  docker exec -i "$API_CONTAINER" node dist/cli/dograh-callback-numbers.js \
    --file=/dev/stdin "$@" < "$NUMBERS"
}

case "$MODE" in
  "")
    python3 "$INSTALLER" "${INSTALL_ARGS[@]}" --numbers-out "$NUMBERS"
    echo
    echo "Hopwhistle would mark these $(wc -l < "$NUMBERS") numbers as AI callbacks"
    echo "(the API is rebuilt first on --apply, so this is not checked against its database now)."
    echo "Dry run. To do it:  $0 $AGENT --apply"
    ;;
  --apply)
    OUT="$(python3 "$INSTALLER" "${INSTALL_ARGS[@]}" --numbers-out "$NUMBERS" --apply | tee /dev/stderr)"
    BRIDGE="$(printf '%s\n' "$OUT" | sed -n 's/^ *DOGRAH_CALLBACK_BRIDGE=//p' | tail -1)"
    if [ -z "$BRIDGE" ]; then
      echo "The Dograh/Asterisk step did not finish; nothing changed in Hopwhistle." >&2
      exit 1
    fi
    set_env DOGRAH_CALLBACK_BRIDGE "$BRIDGE"
    echo "Set DOGRAH_CALLBACK_BRIDGE=$BRIDGE in $ENVF"
    "$ROOT/scripts/deploy.sh" --build api
    mark_numbers --apply
    docker cp "$ROOT/apps/freeswitch/scripts/inbound_route.lua" \
      "$FS_CONTAINER:/usr/share/freeswitch/scripts/inbound_route.lua"
    echo
    echo "Done. Call one of the AI's caller-ID numbers from your cell: agent $AGENT should answer."
    echo "API log line to look for:  [FS-LOOKUP] AI callback:"
    ;;
  --rollback)
    set_env DOGRAH_CALLBACK_BRIDGE ""
    "$ROOT/scripts/deploy.sh" --build api
    : > "$NUMBERS"
    mark_numbers --apply
    python3 "$INSTALLER" "${INSTALL_ARGS[@]}" --rollback --apply
    echo "Rolled back: callbacks use each number's normal route again."
    ;;
  *)
    echo "Unknown option: $MODE" >&2
    exit 1
    ;;
esac
