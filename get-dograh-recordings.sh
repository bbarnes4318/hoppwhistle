#!/usr/bin/env bash
#
# Dograh AI voice recordings — run this ON THE SERVER.
#
#   cd /opt/hopwhistle
#   ./get-dograh-recordings.sh                          # 8/25/2026 through 9/1/2026
#   ./get-dograh-recordings.sh 2026-09-02 2026-09-08    # any other window
#   DOGRAH_TZ=utc ./get-dograh-recordings.sh            # read the dates as UTC
#
# Both dates are inclusive and are read as US Eastern (-04:00) unless DOGRAH_TZ
# says otherwise, so "9/1" means all of September 1st the way the floor means it.
#
# The AI voice calls belong to the self-hosted Dograh stack in /opt/dograh, not
# to Hopwhistle — different database, different recording storage. So the export
# runs inside the Dograh api container, where DATABASE_URL and the recording
# bucket credentials already are, and this copies the results back out.
#
# There is a get-dograh-recordings.ps1 alongside this for running the same thing
# from a Windows PC; that one is PowerShell and will not run here.
#
# Read-only: the export only reads Dograh's database and pulls the audio it
# points at. It writes nothing back to Dograh.

set -euo pipefail

FROM="${1:-2026-08-25}"
TO="${2:-2026-09-01}"
TZ_ARG="${DOGRAH_TZ:--04:00}"
CONTAINER="${DOGRAH_CONTAINER:-dograh-api-1}"

SLUG="$(printf '%s' "${FROM}_to_${TO}" | sed 's/[^a-zA-Z0-9._-]/_/g')"
OUT_DIR="/root/dograh-recordings-$SLUG"
TARBALL="/root/dograh-recordings-$SLUG.tar.gz"
IN_CONTAINER="/tmp/dograh-rec"

echo "============================================="
echo "Dograh AI Voice Recordings - $FROM through $TO"
echo "============================================="
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "No docker on this machine — this script runs ON THE SERVER." >&2
  echo "From a Windows PC use get-dograh-recordings.ps1 instead." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "The Dograh api container ($CONTAINER) is not running." >&2
  echo >&2
  echo "Dograh is its own stack: cd /opt/dograh && docker compose ps" >&2
  echo "If the container has a different name there, pass it in:" >&2
  echo "  DOGRAH_CONTAINER=<name> $0 $FROM $TO" >&2
  exit 1
fi

# A previous window's output would otherwise be copied back out along with this
# one's, so the container's working directory starts empty every run.
docker exec "$CONTAINER" rm -rf "$IN_CONTAINER" >/dev/null 2>&1 || true
docker exec "$CONTAINER" mkdir -p "$IN_CONTAINER" >/dev/null
docker cp deploy/dograh/export_recordings.py "$CONTAINER:$IN_CONTAINER/export_recordings.py" >/dev/null

status=0
docker exec "$CONTAINER" python "$IN_CONTAINER/export_recordings.py" \
  --from "$FROM" --to "$TO" --tz "$TZ_ARG" --out "$IN_CONTAINER/out" || status=$?

# 2 means the window matched no calls at all; the export has already printed
# what Dograh does hold, and there is nothing to copy back.
if [ "$status" -eq 2 ]; then
  exit 2
fi

rm -rf "$OUT_DIR" "$TARBALL"
mkdir -p "$OUT_DIR"
docker cp "$CONTAINER:$IN_CONTAINER/out/." "$OUT_DIR/" >/dev/null

echo
echo "files:      $OUT_DIR  ($(du -sh "$OUT_DIR" | cut -f1))"
echo "  manifest.csv   every call in the window, one row each"
echo "  audio/         the recordings themselves"

# A week of dialing can be gigabytes of wav, and the archive is a second copy
# of all of it. Past a few GB that is a good way to fill /root, so the archive
# is skipped and the directory gets copied down directly instead.
SIZE_MB="$(du -sm "$OUT_DIR" | cut -f1)"
ARCHIVE_LIMIT_MB="${DOGRAH_ARCHIVE_LIMIT_MB:-4096}"
if [ "$SIZE_MB" -gt "$ARCHIVE_LIMIT_MB" ]; then
  COPY_HINT="scp -r -i \$env:USERPROFILE\\.ssh\\hetzner_pvn root@178.156.223.97:$OUT_DIR \$env:USERPROFILE\\Downloads\\"
  echo
  echo "No archive: ${SIZE_MB}MB is over the ${ARCHIVE_LIMIT_MB}MB limit, and taring it"
  echo "would put a second copy of it on this disk. Copy the directory instead."
else
  tar -czf "$TARBALL" -C "$(dirname "$OUT_DIR")" "$(basename "$OUT_DIR")"
  COPY_HINT="scp -i \$env:USERPROFILE\\.ssh\\hetzner_pvn root@178.156.223.97:$TARBALL \$env:USERPROFILE\\Downloads\\"
  echo "one archive: $TARBALL  ($(du -h "$TARBALL" | cut -f1))"
fi

if [ "$status" -ne 0 ]; then
  echo
  echo "Some recordings did not come down. The manifest's status and note"
  echo "columns say which and why, row by row." >&2
fi

cat <<EOF

To get them onto your PC, run this FROM A WINDOWS POWERSHELL WINDOW
(not here — this is the server):

  $COPY_HINT

Or let get-dograh-recordings.ps1 do the whole thing from the PC.
EOF

exit "$status"
