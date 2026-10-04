#!/usr/bin/env bash
# Find, and with --fix clear, stale UDP connection-tracking entries that stop
# a carrier's SIP from reaching FreeSWITCH.
#
#   scripts/sip-conntrack.sh          # report only
#   scripts/sip-conntrack.sh --fix    # report, then delete the stale entries
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# Docker publishes FreeSWITCH's SIP ports (5080 carriers, 5070 Vapi) with a
# DNAT rule. Linux applies NAT once, when a flow's first packet creates its
# conntrack entry, and UDP has no connection close -- so an entry created while
# FreeSWITCH was down or restarting (before the DNAT rule existed, or pointing
# at the previous container's address) keeps steering that carrier's packets
# to nowhere. A carrier that sends OPTIONS keepalives refreshes the entry
# faster than it can time out, so it never heals on its own.
#
# On 2026-10-04 that is what Telnyx's 192.76.120.10 looked like: its INVITEs
# arrived on eth0 and never reached the container, so every inbound call waited
# ~3s for Telnyx to give up on it and fail over to 64.16.250.10.
#
# A healthy entry's reply source is the FreeSWITCH container's address (the
# DNAT happened). A stale one replies from the host itself, or from an address
# that is no longer FreeSWITCH's. Deleting an entry is harmless: the carrier's
# next packet creates a fresh one, through the current DNAT rule.
set -euo pipefail

FIX=""
[ "${1:-}" = "--fix" ] && FIX=1

CONTAINER="hopwhistle-freeswitch-dev"
PORTS="5080 5070"
RED() { printf "\033[31m%s\033[0m\n" "$*" >&2; }
GRN() { printf "\033[32m%s\033[0m\n" "$*"; }
YEL() { printf "\033[33m%s\033[0m\n" "$*"; }

if ! command -v conntrack >/dev/null 2>&1; then
  if [ -n "$FIX" ] && command -v apt-get >/dev/null 2>&1; then
    YEL "installing the conntrack tool (one-time)"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq conntrack >/dev/null
  else
    RED "the conntrack tool is not installed; run with --fix to install it, or: apt-get install -y conntrack"
    exit 1
  fi
fi

fs_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$CONTAINER" 2>/dev/null | xargs || true)"
if [ -z "$fs_ip" ]; then
  RED "$CONTAINER is not running; nothing to check"
  exit 1
fi
echo "FreeSWITCH container address(es): $fs_ip"

stale_total=0
for port in $PORTS; do
  # One line per flow: "<carrier ip> <reply source>". The reply source is the
  # second src= on a conntrack line (the first is the original source).
  entries="$(conntrack -L -p udp --orig-port-dst "$port" 2>/dev/null \
    | awk '{n=0; for(i=1;i<=NF;i++) if ($i ~ /^src=/) { n++; v=substr($i,5); if(n==1) o=v; if(n==2) r=v } print o, r}' || true)"
  [ -n "$entries" ] || continue
  while read -r origin reply; do
    [ -n "$origin" ] || continue
    case " $fs_ip " in
      *" $reply "*) echo "  ok     udp/$port from $origin -> FreeSWITCH ($reply)" ;;
      *)
        stale_total=$((stale_total + 1))
        RED "  STALE  udp/$port from $origin -> $reply (not FreeSWITCH): this carrier's SIP is being dropped"
        if [ -n "$FIX" ]; then
          conntrack -D -p udp --orig-src "$origin" --orig-port-dst "$port" >/dev/null 2>&1 || true
          GRN "         cleared; its next packet goes to FreeSWITCH"
        fi
        ;;
    esac
  done <<< "$entries"
done

# A firewall rule is the other thing that drops a single carrier's packets.
# Reported, never changed.
rules="$(iptables -S 2>/dev/null | grep -E 'DROP|REJECT' | grep -E '5080|5070|192\.76\.120\.|64\.16\.250\.' || true)"
if [ -n "$rules" ]; then
  YEL "firewall rules that could drop carrier SIP (not changed by this script):"
  echo "$rules"
fi

if [ "$stale_total" -eq 0 ]; then
  GRN "no stale SIP entries"
elif [ -z "$FIX" ]; then
  YEL "$stale_total stale entr$([ "$stale_total" -eq 1 ] && echo y || echo ies). Clear with: scripts/sip-conntrack.sh --fix"
  exit 2
fi
