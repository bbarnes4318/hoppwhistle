#!/usr/bin/env bash
set -euo pipefail

REPO=/opt/hopwhistle
BASE_SCRIPT=/tmp/deploy-campaign-routing-base.sh

cd "$REPO"
echo "=== PREPARE COMPLETE PERMANENT ROUTING RELEASE ==="
git fetch origin

# The shared web Dockerfile requires this permanent source patch. The original
# emergency deployer copied the Dockerfile but accidentally omitted this file.
required_file=scripts/apply-softphone-ringback-dtmf-source.mjs
mkdir -p "$(dirname "$REPO/$required_file")"
tmp="$(mktemp)"
git show "origin/main:$required_file" > "$tmp"
install -m 0644 "$tmp" "$REPO/$required_file"
rm -f "$tmp"

if [ ! -s "$REPO/$required_file" ]; then
  echo "ERROR: Required web softphone source patch was not installed" >&2
  exit 1
fi

echo "Required web softphone source patch: INSTALLED"

# Execute the canonical deployment/audit script from current origin/main.
git show "origin/main:scripts/deploy-and-audit-campaign-transfer-routing.sh" > "$BASE_SCRIPT"
chmod 0700 "$BASE_SCRIPT"
exec "$BASE_SCRIPT"
