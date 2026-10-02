#!/usr/bin/env bash
# Keeps the newest KEEP (default 2) rollback/candidate images per repository and
# deletes the rest, plus build cache older than 72h. Without --apply it only
# prints what it would remove.
#
# Only touches images whose repository ends in -rollback or -candidate, starts
# with rollback/, or whose tag starts with rollback-. Running images are never
# removed (docker refuses), and untagged/dangling images are left alone because
# the deploy runbook uses the pre-deploy image ID as its rollback target.
#
# Usage: scripts/prune-docker-images.sh [--apply]      KEEP=3 scripts/prune-docker-images.sh --apply
set -euo pipefail

KEEP="${KEEP:-2}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

before="$(df -h / | awk 'NR==2 {print $4 " free (" $5 " used)"}')"

candidates="$(
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -v '<none>' | while read -r ref; do
    repo="${ref%:*}"
    tag="${ref##*:}"
    if [[ "$repo" =~ ^rollback/ || "$repo" =~ -rollback$ || "$repo" =~ -candidate$ ]]; then
      key="$repo"
    elif [[ "$tag" =~ ^rollback- ]]; then
      key="$repo#rollback-tags"
    else
      continue
    fi
    printf '%s %s %s\n' "$key" "$(docker image inspect --format '{{.Created}}' "$ref")" "$ref"
  done | sort -k1,1 -k2,2r | awk -v keep="$KEEP" '++n[$1] > keep { print $3 }'
)"

if [ -z "$candidates" ]; then
  echo "no old rollback/candidate images to remove (keeping newest $KEEP per repo)"
else
  echo "old rollback/candidate images (keeping newest $KEEP per repo):"
  echo "$candidates" | sed 's/^/  /'
  if [ "$APPLY" -eq 1 ]; then
    echo "$candidates" | while read -r ref; do
      docker rmi "$ref" >/dev/null 2>&1 && echo "  removed $ref" || echo "  skipped $ref (in use)"
    done
  fi
fi

if [ "$APPLY" -eq 1 ]; then
  docker builder prune -f --filter until=72h >/dev/null
  echo "disk before: $before"
  echo "disk after:  $(df -h / | awk 'NR==2 {print $4 " free (" $5 " used)"}')"
else
  echo "dry run - re-run with --apply to delete"
fi
