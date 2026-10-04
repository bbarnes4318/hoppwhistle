#!/usr/bin/env bash
#
# Dograh caller IDs — run this ON THE SERVER.
#
#   cd /opt/hopwhistle   (or any dir holding the files below at the same paths)
#   ./sync-dograh-caller-ids.sh            # dry run: shows what would be added
#   ./sync-dograh-caller-ids.sh --apply    # writes them into Dograh
#
# Dograh keeps its own list of caller IDs (telephony_phone_numbers in its own
# Postgres). Adding FracTEL DIDs to apps/api/data/dograh-state-caller-ids.csv
# does nothing on its own: the numbers only show up in Dograh — and only enter
# the outbound rotation — once that CSV is imported into Dograh's database.
# This is that import, as one command.
#
# Safe to re-run. Numbers already in Dograh are left as they are (or have their
# state tag corrected); nothing is deleted. No restart is needed: Dograh reloads
# the active numbers for the configuration at the start of every campaign batch.
#
#   DOGRAH_CONTAINER=<name>   api container (default dograh-api-1)
#   DOGRAH_ORG_ID=<id>        organization (default 1)
#   DOGRAH_TCID=<id>          telephony configuration the DIDs go out on —
#                             FracTEL (default 1)
#   CID_CSV=<path>            number,state CSV (default the repo's list)

set -euo pipefail

APPLY=""
if [ "${1:-}" = "--apply" ]; then
  APPLY="--apply"
fi

CONTAINER="${DOGRAH_CONTAINER:-dograh-api-1}"
ORG_ID="${DOGRAH_ORG_ID:-1}"
TCID="${DOGRAH_TCID:-1}"
CSV="${CID_CSV:-apps/api/data/dograh-state-caller-ids.csv}"
IN_CONTAINER="/tmp/cid-import"

echo "============================================="
echo "Dograh caller IDs - $([ -n "$APPLY" ] && echo APPLY || echo DRY RUN)"
echo "============================================="
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "No docker on this machine — this script runs ON THE SERVER." >&2
  echo "From a Windows PC use sync-dograh-caller-ids.ps1 instead." >&2
  exit 1
fi

if [ ! -f "$CSV" ]; then
  echo "No caller-ID list at $CSV (run this from /opt/hopwhistle)." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "The Dograh api container ($CONTAINER) is not running." >&2
  echo "Dograh is its own stack: cd /opt/dograh && docker compose ps" >&2
  echo "If the container has a different name there: DOGRAH_CONTAINER=<name> $0 $APPLY" >&2
  exit 1
fi

echo "list:     $CSV ($(($(wc -l <"$CSV") - 1)) numbers)"
echo "dograh:   $CONTAINER  org=$ORG_ID  telephony config=$TCID"
echo

docker exec "$CONTAINER" rm -rf "$IN_CONTAINER" >/dev/null 2>&1 || true
docker exec "$CONTAINER" mkdir -p "$IN_CONTAINER" >/dev/null
docker cp deploy/dograh/import_state_caller_ids.py "$CONTAINER:$IN_CONTAINER/" >/dev/null
docker cp deploy/dograh/areacode_state.py "$CONTAINER:$IN_CONTAINER/" >/dev/null
docker cp "$CSV" "$CONTAINER:$IN_CONTAINER/caller-ids.csv" >/dev/null

docker exec "$CONTAINER" python "$IN_CONTAINER/import_state_caller_ids.py" \
  --csv "$IN_CONTAINER/caller-ids.csv" --org-id "$ORG_ID" --tcid "$TCID" $APPLY

docker exec "$CONTAINER" rm -rf "$IN_CONTAINER" >/dev/null 2>&1 || true

echo
if [ -n "$APPLY" ]; then
  cat <<'EOF'
Done. config_active_before -> config_active_after above is the caller-ID count
Dograh shows for this configuration. Refresh the Dograh phone numbers page; the
next campaign batch picks the new numbers up without a restart.
EOF
else
  cat <<EOF
Dry run — nothing was written. "inserted" is how many numbers Dograh is
missing; config_active_before is what it shows today. To write them:

  $0 --apply
EOF
fi
