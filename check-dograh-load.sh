#!/usr/bin/env bash
#
# Is the server keeping up with today's Dograh AI calls? — run this ON THE SERVER.
#
#   cd /opt/hopwhistle
#   ./check-dograh-load.sh              # one snapshot; changes nothing
#   ./check-dograh-load.sh --watch 60   # repeat every 60s (Ctrl-C to stop)
#
# Read-only. It looks at:
#   1. the host: CPU load per core, memory, swap, disk;
#   2. the Dograh containers: up, restarting, OOM-killed, CPU/memory now;
#   3. live calls: Asterisk channels vs. the concurrency slots Dograh holds in
#      Redis (concurrent_calls:*) vs. the org's concurrent-call limit, and slots
#      older than 20 min (leaked by an api restart mid-campaign);
#   4. today's call volume and anything queued or stuck "running";
#   5. the last 30 min of api/asterisk errors.
# and ends with a verdict: OK, or each problem with what to do about it.
#
#   DOGRAH_API=<name>        (default dograh-api-1)
#   DOGRAH_ASTERISK=<name>   (default dograh-asterisk)
#   DOGRAH_ORG_ID=<id>       (default 1)
#   DOGRAH_TZ=<offset>       day boundary for "today" (default -04:00, US Eastern)

set -uo pipefail

API="${DOGRAH_API:-dograh-api-1}"
AST="${DOGRAH_ASTERISK:-dograh-asterisk}"
ORG="${DOGRAH_ORG_ID:-1}"
TZ_OFF="${DOGRAH_TZ:--04:00}"

if [ "${1:-}" = "--watch" ]; then
  every="${2:-60}"
  while true; do
    clear
    date
    "$0"
    sleep "$every"
  done
fi
[ $# -gt 0 ] && { echo "unknown argument: $1" >&2; exit 1; }

RED() { printf "\033[31m%s\033[0m\n" "$*"; }
GRN() { printf "\033[32m%s\033[0m\n" "$*"; }
YEL() { printf "\033[33m%s\033[0m\n" "$*"; }
HDR() { echo; printf "\033[36m== %s ==\033[0m\n" "$*"; }

PROBLEMS=()
WARNINGS=()
problem() { RED "  PROBLEM: $1"; PROBLEMS+=("$1|$2"); }
warn() { YEL "  WARNING: $1"; WARNINGS+=("$1"); }

# Integer compare on decimals: gt 3.5 2 -> true
gt() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a>b)}'; }

# ---------------------------------------------------------------------------
HDR "1. Host"
cores="$(nproc)"
read -r l1 l5 l15 _ < /proc/loadavg
per_core="$(awk -v l="$l5" -v c="$cores" 'BEGIN{printf "%.2f", l/c}')"
echo "  cores: $cores   load 1/5/15 min: $l1 / $l5 / $l15   (5-min load per core: $per_core)"
if gt "$per_core" 1.5; then
  problem "CPU is overloaded: 5-min load is ${per_core}x the core count" cpu
elif gt "$per_core" 0.9; then
  warn "CPU is near capacity: 5-min load is ${per_core}x the core count"
fi

mem_total="$(awk '/^MemTotal/{print $2}' /proc/meminfo)"
mem_avail="$(awk '/^MemAvailable/{print $2}' /proc/meminfo)"
swap_total="$(awk '/^SwapTotal/{print $2}' /proc/meminfo)"
swap_free="$(awk '/^SwapFree/{print $2}' /proc/meminfo)"
mem_pct="$(awk -v a="$mem_avail" -v t="$mem_total" 'BEGIN{printf "%d", 100*a/t}')"
swap_used_mb=$(( (swap_total - swap_free) / 1024 ))
echo "  memory: $(( mem_avail / 1024 )) MB available of $(( mem_total / 1024 )) MB (${mem_pct}% free)   swap used: ${swap_used_mb} MB"
if [ "$mem_pct" -lt 10 ]; then
  problem "only ${mem_pct}% of memory is available" mem
elif [ "$mem_pct" -lt 20 ]; then
  warn "memory is getting low (${mem_pct}% available)"
fi
[ "$swap_used_mb" -gt 1024 ] && warn "${swap_used_mb} MB of swap in use: audio gets choppy when the voice pipeline swaps"

disk_pct="$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')"
echo "  disk /: ${disk_pct}% used"
if [ "$disk_pct" -ge 95 ]; then
  problem "root disk is ${disk_pct}% full (recordings and logs stop being written)" disk
elif [ "$disk_pct" -ge 85 ]; then
  warn "root disk is ${disk_pct}% full"
fi

# ---------------------------------------------------------------------------
HDR "2. Dograh containers"
names="$(docker ps -a --format '{{.Names}}' | grep -iE 'dograh' | sort)"
if [ -z "$names" ]; then
  RED "  No dograh containers found. cd /opt/dograh && docker compose ps"
  exit 1
fi
printf "  %-28s %-10s %-9s %-4s\n" CONTAINER STATUS RESTARTS OOM
for c in $names; do
  st="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)"
  rc="$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null)"
  oom="$(docker inspect -f '{{.State.OOMKilled}}' "$c" 2>/dev/null)"
  printf "  %-28s %-10s %-9s %-4s\n" "$c" "$st" "$rc" "$oom"
  [ "$st" != running ] && problem "container $c is $st" container
  [ "$oom" = true ] && problem "container $c was killed for running out of memory" mem
  [ "${rc:-0}" -gt 0 ] && warn "container $c has restarted $rc time(s)"
done
echo
docker stats --no-stream --format '  {{printf "%-28s" .Name}} cpu {{printf "%-8s" .CPUPerc}} mem {{.MemUsage}} ({{.MemPerc}})' $names 2>/dev/null

for c in "$API" "$AST"; do
  docker ps --format '{{.Names}}' | grep -qx "$c" || {
    RED "  Container $c is not running (pass DOGRAH_API= / DOGRAH_ASTERISK= if named differently)."
    exit 1
  }
done

# ---------------------------------------------------------------------------
HDR "3. Live calls"
ast_calls="$(docker exec "$AST" asterisk -rx "core show channels count" 2>/dev/null | awk '/active call/{print $1}')"
ast_chans="$(docker exec "$AST" asterisk -rx "core show channels count" 2>/dev/null | awk '/active channel/{print $1}')"
echo "  asterisk: ${ast_calls:-?} active calls, ${ast_chans:-?} channels"

state="$(docker exec -i "$API" python - "$ORG" "$TZ_OFF" <<'PY' 2>&1
import asyncio, os, sys, time
org = int(sys.argv[1])
tz = sys.argv[2]

async def redis_part():
    import redis.asyncio as aioredis
    try:
        from api.constants import REDIS_URL
    except Exception:
        REDIS_URL = os.environ["REDIS_URL"]
    r = aioredis.from_url(REDIS_URL, decode_responses=True)
    now = time.time()
    async for key in r.scan_iter("concurrent_calls:*"):
        if await r.type(key) != "zset":
            continue
        total = await r.zcard(key)
        stale = await r.zcount(key, 0, now - 1200)
        print(f"SLOTS {key} {total} {stale}")
    try:
        pool = await r.scard(f"from_number_pool:{org}:1")
        print(f"CIDFREE {pool}")
    except Exception:
        pass
    await r.aclose()

async def limit_part():
    try:
        from api.services.call_concurrency import call_concurrency
        print(f"LIMIT {await call_concurrency.get_org_concurrent_limit(org)}")
    except Exception as e:
        print(f"LIMIT ? ({type(e).__name__})")

async def db_part():
    import asyncpg
    conn = await asyncpg.connect(dsn=os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://"))
    try:
        cols = {r["table_name"] + "." + r["column_name"] for r in await conn.fetch(
            "select table_name, column_name from information_schema.columns "
            "where table_name in ('workflow_runs','queued_runs')")}
        day = f"(date_trunc('day', now() at time zone '{tz}') at time zone '{tz}')"
        if "workflow_runs.state" in cols and "workflow_runs.created_at" in cols:
            for r in await conn.fetch(
                f"select state, count(*) n from workflow_runs where created_at >= {day} group by 1 order by 2 desc"):
                print(f"TODAY {r['state']} {r['n']}")
            for r in await conn.fetch(
                "select count(*) n from workflow_runs where created_at >= now() - interval '15 minutes'"):
                print(f"LAST15 {r['n']}")
            stuck = await conn.fetchval(
                "select count(*) from workflow_runs where state in ('running','initialized','in_progress') "
                "and created_at < now() - interval '30 minutes' and created_at >= now() - interval '1 day'")
            print(f"STUCK {stuck}")
        if "queued_runs.state" in cols:
            for r in await conn.fetch("select state, count(*) n from queued_runs group by 1 order by 1"):
                print(f"QUEUE {r['state']} {r['n']}")
            if "queued_runs.updated_at" in cols:
                old = await conn.fetchval(
                    "select count(*) from queued_runs where state='processing' "
                    "and updated_at < now() - interval '10 minutes'")
                print(f"QSTUCK {old}")
    finally:
        await conn.close()

async def main():
    for part in (redis_part, limit_part, db_part):
        try:
            await part()
        except Exception as e:
            print(f"ERR {part.__name__}: {type(e).__name__}: {e}")
asyncio.run(main())
PY
)"

limit="$(echo "$state" | awk '$1=="LIMIT"{print $2}')"
org_slots="$(echo "$state" | awk -v k="concurrent_calls:$ORG" '$1=="SLOTS" && $2==k{print $3}')"
org_stale="$(echo "$state" | awk -v k="concurrent_calls:$ORG" '$1=="SLOTS" && $2==k{print $4}')"
echo "  Dograh slots held for org $ORG: ${org_slots:-0} of limit ${limit:-?}   (older than 20 min: ${org_stale:-0})"
echo "$state" | awk -v k="concurrent_calls:$ORG" '$1=="SLOTS" && $2!=k{printf "    %s: %s held (%s older than 20 min)\n", $2, $3, $4}'
echo "$state" | awk '$1=="CIDFREE"{print "  caller IDs free in the rotation pool: " $2}'

slots="${org_slots:-0}"
if [ "${org_stale:-0}" -gt 0 ]; then
  # The acquire script prunes these itself on the next call attempt.
  warn "${org_stale} concurrency slot(s) are older than 20 min (a very long call, or leaked; Dograh prunes them at the next call attempt)"
fi
if [ -n "${ast_calls:-}" ] && [ "$slots" -gt $(( ast_calls + 3 )) ]; then
  warn "Dograh holds $slots slots but Asterisk has only $ast_calls calls: slots may be leaking"
fi
if [[ "${limit:-}" =~ ^[0-9]+$ ]] && [ "$limit" -gt 0 ]; then
  if [ "$slots" -ge "$limit" ]; then
    warn "at the concurrent-call limit ($slots/$limit): new calls wait for a free slot (expected while a campaign is busy)"
  fi
  # Rough sizing: each live AI call is an STT + LLM + TTS pipeline in dograh-api.
  per_call_cores=$(awk -v l="$limit" -v c="$cores" 'BEGIN{printf "%.2f", c/l}')
  echo "  sizing: $cores cores for up to $limit concurrent calls = $per_call_cores core(s) per call"
fi

# ---------------------------------------------------------------------------
HDR "4. Today's calls (day starts at midnight $TZ_OFF)"
echo "$state" | awk '$1=="TODAY"{printf "  %-14s %s\n", $2, $3; t+=$3} END{if (t) printf "  %-14s %s\n", "total", t; else print "  no workflow runs yet today"}'
echo "$state" | awk '$1=="LAST15"{print "  started in the last 15 min: " $2}'
echo "$state" | awk '$1=="QUEUE"{printf "  queue %-12s %s\n", $2, $3}'
stuck="$(echo "$state" | awk '$1=="STUCK"{print $2}')"
qstuck="$(echo "$state" | awk '$1=="QSTUCK"{print $2}')"
[ "${stuck:-0}" -gt 0 ] && warn "${stuck} run(s) started over 30 min ago are still not finished"
[ "${qstuck:-0}" -gt 0 ] && problem "${qstuck} queued run(s) stuck in 'processing' for over 10 min: the dispatcher batch is wedged" queue
echo "$state" | grep '^ERR' | sed 's/^ERR /  could not read: /'
echo "$state" | grep -vE '^(SLOTS|LIMIT|CIDFREE|TODAY|LAST15|STUCK|QUEUE|QSTUCK|ERR)' | sed '/^$/d; s/^/  /'

# ---------------------------------------------------------------------------
HDR "5. Errors in the last 30 minutes"
api_log="$(docker logs --since 30m "$API" 2>&1)"
count() { printf '%s\n' "$api_log" | grep -ciE "$1"; }
errs="$(count '\| ERROR|Traceback')"
slotfail="$(count 'Concurrent slot acquisition failed|CallConcurrencyLimit')"
breaker="$(count 'circuit.?breaker.*(open|trip)')"
cid="$(count 'NO_CALLER_ID|All from_numbers')"
timeouts="$(count 'timed? ?out|TimeoutError|429|rate.?limit')"
echo "  $API: $errs errors, $slotfail slot-acquisition failures, $breaker circuit-breaker trips,"
echo "    $cid caller-ID exhaustion, $timeouts timeouts / provider rate limits"
[ "$breaker" -gt 0 ] && problem "the campaign circuit breaker tripped (too many failed calls in a row): dialing is paused" breaker
[ "$errs" -gt 50 ] && warn "$errs errors in 30 min in $API"
[ "$timeouts" -gt 20 ] && warn "$timeouts timeouts / rate limits from the AI providers in 30 min: calls will have long silences"
[ "$cid" -gt 0 ] && warn "calls are waiting for or failing on a free caller ID ($cid lines)"
if [ "$errs" -gt 0 ]; then
  echo "  last few:"
  printf '%s\n' "$api_log" | grep -iE '\| ERROR|Traceback' | tail -5 | cut -c1-220 | sed 's/^/    /'
fi
ast_err="$(docker logs --since 30m "$AST" 2>&1 | grep -ciE 'taskprocessor.*queue.*(high|exceeded)|Unable to create channel|ERROR\[')"
echo "  $AST: $ast_err errors / taskprocessor overload warnings"
[ "$ast_err" -gt 20 ] && warn "$ast_err Asterisk errors in 30 min"

# ---------------------------------------------------------------------------
HDR "Verdict"
if [ "${#PROBLEMS[@]}" -eq 0 ] && [ "${#WARNINGS[@]}" -eq 0 ]; then
  GRN "  OK: the server has headroom and Dograh's calls are flowing normally."
  exit 0
fi
for w in "${WARNINGS[@]}"; do YEL "* $w"; done
[ "${#PROBLEMS[@]}" -eq 0 ] && { GRN "  No hard problems; watch the warnings above."; exit 0; }
shown=" "
for p in "${PROBLEMS[@]}"; do
  msg="${p%|*}"; kind="${p##*|}"
  RED "* $msg"
  case "$shown" in *" $kind "*) continue ;; esac
  shown="$shown$kind "
  case "$kind" in
    cpu|mem)
      cat <<EOF
    Fix: the box is short on CPU/memory for the calls Dograh is running. Lower the
    org's concurrent-call limit in Dograh (Settings -> organization) or the
    campaign's max concurrency until the 5-min load per core stays under ~0.9, or
    resize the server. 'docker stats' above shows which container is using it.
EOF
      ;;
    queue)
      cat <<'EOF'
    Fix: wait for a moment with no live calls ('Live calls' above shows 0 in
    Asterisk), because a restart drops any call that is up, then:
      cd /opt/dograh && docker compose restart api
      then flush concurrent_calls:*, from_number_pool:1:1, workflow_slot_mapping:*,
      workflow_from_number_mapping:*, ari:channel:* in dograh-redis and wait out the
      orchestrator's 300s stuck-batch timer (deploy/dograh/README.md, "Restart caveat").
EOF
      ;;
    disk)
      echo "    Fix: docker system prune -f; docker image prune -a -f; move old recordings off the box (get-dograh-recordings.sh)."
      ;;
    container)
      echo "    Fix: cd /opt/dograh && docker compose up -d   then   docker logs --tail 100 <container>"
      ;;
    breaker)
      echo "    Fix: see the errors above for why calls are failing (carrier: ./diagnose-dograh-fractel.sh), then resume the campaign in Dograh."
      ;;
  esac
done
exit 2
