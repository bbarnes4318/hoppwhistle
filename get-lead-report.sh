#!/usr/bin/env bash
#
# Buyer disposition report — run this ON THE SERVER.
#
#   cd /opt/hopwhistle
#   ./get-lead-report.sh                    # defaults to fe-august-2026
#   ./get-lead-report.sh fe-september-2026  # any other list
#   ./get-lead-report.sh --all              # every list in the tenant
#
# Prints the counts and leaves four CSVs in /root/. There is a get-lead-report.ps1
# alongside this for running the same thing from a Windows PC; that one is
# PowerShell and will not run here.
#
# Read-only: the underlying script only reads the database and writes CSVs.

set -euo pipefail

CONTAINER="hopwhistle-api-dev"
OUT_DIR="/root"

if [ "${1:-}" = "--all" ]; then
  SLUG="all-leads"
  LIST_ARG=""
  LABEL="every list"
else
  LIST_NAME="${1:-fe-august-2026}"
  # Matches the slug the report builds from the list name, so the filenames we
  # look for are the ones it actually wrote.
  SLUG="$(printf '%s' "$LIST_NAME" | sed 's/[^a-zA-Z0-9-]/_/g')"
  LIST_ARG="$LIST_NAME"
  LABEL="list '$LIST_NAME'"
fi

echo "============================================="
echo "Buyer Disposition Report - $LABEL"
echo "============================================="
echo

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "The API container ($CONTAINER) is not running. Start the stack first." >&2
  exit 1
fi

docker cp scripts/export-buyer-disposition.mjs "$CONTAINER:/app/disposition.mjs" >/dev/null
docker exec -u root "$CONTAINER" node /app/disposition.mjs $LIST_ARG

echo
for part in all accepted rejected never-sent; do
  docker cp "$CONTAINER:/app/$SLUG-$part.csv" "$OUT_DIR/" >/dev/null
done

ls -lh "$OUT_DIR/$SLUG-"*.csv

cat <<EOF

Done. The files are in $OUT_DIR on this server.

To get them onto your PC, run this FROM A WINDOWS POWERSHELL WINDOW
(not here — this is the server):

  scp -i C:\\Users\\jimbo\\.ssh\\hetzner_pvn root@178.156.223.97:$OUT_DIR/$SLUG-*.csv C:\\Users\\jimbo\\Downloads\\

Do NOT re-send anything in the rejected file. Those have already spent their
90-day duplicate window; posting them again makes them permanently unsellable.
Only never-sent is safe to fix and re-import.
EOF
