#!/usr/bin/env bash
# Move Docker's storage off the root disk and onto an attached Hetzner volume.
#
# Why: attaching a Hetzner volume only mounts an empty disk at
# /mnt/HC_Volume_<id>. Docker keeps writing everything (images, containers,
# named volumes - Postgres, Dograh, recordings) to /var/lib/docker on the root
# disk, so the root disk still fills up while the new volume sits unused.
#
# Usage (on the server, as root):
#   ./move-docker-to-volume.sh                 # diagnose only, changes nothing
#   ./move-docker-to-volume.sh --migrate       # move Docker onto the volume
#   ./move-docker-to-volume.sh --migrate /mnt/HC_Volume_12345678
#
# --migrate stops Docker for the duration of the copy: every container,
# including live calls, goes down until it finishes. Run it in a quiet window.
# The old data is kept as /var/lib/docker.old until you delete it yourself.

set -euo pipefail

MODE="diagnose"
VOLUME=""
for arg in "$@"; do
  case "$arg" in
    --migrate) MODE="migrate" ;;
    /*) VOLUME="$arg" ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }

say() { printf '\n== %s\n' "$*"; }

current_root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"

# ---------------------------------------------------------------- diagnose
say "Disk usage"
df -h -x tmpfs -x devtmpfs -x overlay

say "Block devices"
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT

if [[ -z "$VOLUME" ]]; then
  mapfile -t found < <(findmnt -rn -o TARGET | grep -E '^/mnt/HC_Volume_' || true)
  if [[ ${#found[@]} -eq 1 ]]; then
    VOLUME="${found[0]}"
  elif [[ ${#found[@]} -gt 1 ]]; then
    say "Several Hetzner volumes are mounted; pass the one to use:"
    printf '  %s\n' "${found[@]}"
  fi
fi

say "Docker"
echo "Docker data root: $current_root"
docker system df 2>/dev/null || true
echo "Size of $current_root: $(du -sh "$current_root" 2>/dev/null | cut -f1)"
echo "systemd journal: $(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+[KMGT]' | tail -1)"

say "Volume"
if [[ -z "$VOLUME" ]]; then
  cat <<'EOF'
No Hetzner volume is mounted. Check the Hetzner console that the volume is
attached to THIS server, then mount it. If it was attached without
"automount", the console shows the exact commands (format only if it is new
and empty). It must be listed in /etc/fstab or it disappears on reboot.
EOF
  exit 1
fi
if ! mountpoint -q "$VOLUME"; then
  echo "$VOLUME is not a mount point - it is a plain folder on the root disk." >&2
  exit 1
fi
df -h "$VOLUME"
if grep -qs " $VOLUME " /etc/fstab; then
  echo "fstab: ok (mounted at boot)"
else
  echo "WARNING: $VOLUME is not in /etc/fstab and will not come back after a reboot."
fi

case "$current_root" in
  "$VOLUME"/*)
    echo
    echo "Docker already stores its data on the volume ($current_root). Nothing to move."
    exit 0 ;;
esac

if [[ "$MODE" != "migrate" ]]; then
  cat <<EOF

Docker is still writing to the root disk ($current_root), not to $VOLUME.
To move it, run:   $0 --migrate $VOLUME
EOF
  exit 0
fi

# ---------------------------------------------------------------- migrate
TARGET="$VOLUME/docker"
used_kb=$(du -sk "$current_root" | cut -f1)
free_kb=$(df -Pk "$VOLUME" | awk 'NR==2 {print $4}')
if (( used_kb + 1048576 > free_kb )); then
  echo "Not enough room on $VOLUME: need $((used_kb/1024)) MB + 1 GB, have $((free_kb/1024)) MB." >&2
  exit 1
fi
if ! grep -qs " $VOLUME " /etc/fstab; then
  echo "Add $VOLUME to /etc/fstab first, or Docker will start empty after a reboot." >&2
  exit 1
fi
if [[ -e "$TARGET" && -n "$(ls -A "$TARGET" 2>/dev/null)" ]]; then
  echo "$TARGET already exists and is not empty; refusing to overwrite it." >&2
  exit 1
fi

read -r -p "This stops ALL containers (calls drop) until the copy finishes. Type MOVE to continue: " ok
[[ "$ok" == "MOVE" ]] || { echo "Aborted."; exit 1; }

running_file="$(mktemp)"
docker ps -q > "$running_file"
echo "$(wc -l < "$running_file") containers running before the move."

say "Pre-copy while Docker is still running (shortens the downtime)"
mkdir -p "$TARGET"
rsync -aHAX --numeric-ids "$current_root"/ "$TARGET"/ || true

say "Stopping Docker"
systemctl stop docker.socket docker.service
systemctl stop containerd 2>/dev/null || true

say "Final copy"
rsync -aHAX --numeric-ids --delete "$current_root"/ "$TARGET"/

say "Pointing Docker at $TARGET"
daemon_json=/etc/docker/daemon.json
mkdir -p /etc/docker
[[ -f "$daemon_json" ]] && cp "$daemon_json" "$daemon_json.bak-$(date +%s)"
python3 - "$daemon_json" "$TARGET" <<'PY'
import json, os, sys
path, target = sys.argv[1], sys.argv[2]
cfg = {}
if os.path.exists(path) and os.path.getsize(path):
    with open(path) as f:
        cfg = json.load(f)
cfg["data-root"] = target
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY
cat "$daemon_json"

mv "$current_root" "$current_root.old"

say "Starting Docker"
systemctl start containerd 2>/dev/null || true
systemctl start docker
new_root="$(docker info -f '{{.DockerRootDir}}')"
echo "Docker data root is now: $new_root"
if [[ "$new_root" != "$TARGET" ]]; then
  echo "Docker did not pick up the new data-root. Roll back with:" >&2
  echo "  systemctl stop docker; mv $current_root.old $current_root; restore $daemon_json from its .bak; systemctl start docker" >&2
  exit 1
fi

# Containers with a restart policy come back by themselves; start the rest.
sleep 5
while read -r id; do
  [[ -n "$id" ]] || continue
  if [[ "$(docker inspect -f '{{.State.Running}}' "$id" 2>/dev/null)" != "true" ]]; then
    docker start "$id" >/dev/null && echo "started $(docker inspect -f '{{.Name}}' "$id")"
  fi
done < "$running_file"
rm -f "$running_file"

say "Done"
docker ps --format 'table {{.Names}}\t{{.Status}}'
df -h / "$VOLUME"
cat <<EOF

Check the apps (dashboard, a test call, Dograh). Once you are happy, free the
root disk with:
  rm -rf $current_root.old
Until then the old copy still takes up the same space on the root disk.
EOF
