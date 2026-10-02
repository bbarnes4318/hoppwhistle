#!/usr/bin/env bash
# Live check of the softphone's three-way merge against real FreeSWITCH.
# Needs Docker and `pnpm install` at the repo root. See README.md.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
image="${IMAGE:-hopwhistle-freeswitch:three-way-test}"
conf=/usr/share/freeswitch/conf/vanilla

if [ -z "${SKIP_BUILD:-}" ]; then
  docker build -q -f "$root/apps/freeswitch/Dockerfile" -t "$image" "$root" >/dev/null
fi

docker network create fs-three-way >/dev/null 2>&1 || true
cleanup() { docker rm -f sw ph >/dev/null 2>&1 || true; docker network rm fs-three-way >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup; docker network create fs-three-way >/dev/null

# sw: the switch under test (production image + config). ph: plays every phone.
for n in sw ph; do
  docker run -d --name "$n" --network fs-three-way \
    -e SIP_DOMAIN="$n" -e FREESWITCH_ESL_PASSWORD=ClueCon -e FREESWITCH_INTERNAL_KEY=test \
    -v "$here/esl.xml:$conf/autoload_configs/event_socket.conf.xml:ro" \
    -v "$here/$n-public.xml:$conf/dialplan/public.xml:ro" \
    -v "$here/rig_inbound.lua:/usr/share/freeswitch/scripts/rig_inbound.lua:ro" \
    "$image" >/dev/null
done

ip() { docker inspect -f '{{(index .NetworkSettings.Networks "fs-three-way").IPAddress}}' "$1"; }
echo "waiting for FreeSWITCH..."
for _ in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/$(ip sw)/8021" && exec 4<>"/dev/tcp/$(ip ph)/8021") 2>/dev/null; then break; fi
  sleep 1
done
sleep 5 # sofia profiles come up after ESL

cd "$root/apps/api"
FREESWITCH_HOST="$(ip sw)" PH_HOST="$(ip ph)" LOG_LEVEL=warn \
  "$root/node_modules/.bin/tsx" "$here/rig.ts" "${1:-all}"
