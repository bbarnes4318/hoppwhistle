#!/usr/bin/env bash
#
# Why aren't Dograh AI calls going out over FracTEL? — run this ON THE SERVER.
#
#   cd /opt/hopwhistle
#   ./diagnose-dograh-fractel.sh                                # checks only, changes nothing
#   ./diagnose-dograh-fractel.sh --test-call 5551234567 --caller-id 8392000722
#
# A Dograh AI call goes: Dograh api -> ARI -> dograh-asterisk ->
# PJSIP/<number>@fractel -> FracTEL. Earlier carrier work can each move it off
# FracTEL without anything looking broken in Dograh:
#
#   * DOGRAH_ARI_TRUNK=anveo|twilio   (deploy/dograh/ari-trunk) sends calls to
#     another trunk;
#   * DOGRAH_ARI_DIAL_PREFIX=012345   (Anveo's tech prefix) left set, so FracTEL
#     is asked to dial 0123451XXXXXXXXXX and refuses it;
#   * a telephony configuration whose dial template says @twilio;
#   * set_caller_id_pool.py (anveo-trunk) leaving only the 3 Anveo numbers as
#     active caller IDs, which FracTEL will not present;
#   * the `fractel` PJSIP endpoint missing, or FracTEL refusing the INVITE.
#
# This prints each of those and a verdict. --test-call places one call to your
# phone through the fractel endpoint directly, bypassing Dograh: if that rings
# and Dograh's calls don't, the problem is Dograh's settings; if it doesn't,
# it is the trunk/carrier, and the Asterisk log lines printed say why.
#
#   DOGRAH_API=<name>        (default dograh-api-1)
#   DOGRAH_ASTERISK=<name>   (default dograh-asterisk)
#   DOGRAH_TCID=<id>         telephony configuration to inspect (default 1)

set -uo pipefail

API="${DOGRAH_API:-dograh-api-1}"
AST="${DOGRAH_ASTERISK:-dograh-asterisk}"
TCID="${DOGRAH_TCID:-1}"
TEST_TO=""
TEST_CID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --test-call) TEST_TO="${2:-}"; shift 2 ;;
    --caller-id) TEST_CID="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

RED() { printf "\033[31m%s\033[0m\n" "$*"; }
GRN() { printf "\033[32m%s\033[0m\n" "$*"; }
YEL() { printf "\033[33m%s\033[0m\n" "$*"; }
HDR() { echo; printf "\033[36m== %s ==\033[0m\n" "$*"; }

PROBLEMS=()
problem() { RED "  PROBLEM: $1"; PROBLEMS+=("$1|$2"); }

ten() {
  local d
  d="$(printf '%s' "$1" | tr -cd '0-9')"
  [ "${#d}" -eq 11 ] && [ "${d:0:1}" = "1" ] && d="${d:1}"
  [ "${#d}" -eq 10 ] && printf '%s' "$d"
}

for c in "$API" "$AST"; do
  if ! docker ps --format '{{.Names}}' | grep -qx "$c"; then
    RED "Container $c is not running."
    echo "  cd /opt/dograh && docker compose ps     (pass DOGRAH_API= / DOGRAH_ASTERISK= if named differently)"
    exit 1
  fi
done

# ---------------------------------------------------------------------------
HDR "1. Which trunk Dograh dials"
trunk="$(docker exec "$API" printenv DOGRAH_ARI_TRUNK 2>/dev/null || true)"
xfer="$(docker exec "$API" printenv DOGRAH_ARI_TRANSFER_TRUNK 2>/dev/null || true)"
prefix="$(docker exec "$API" printenv DOGRAH_ARI_DIAL_PREFIX 2>/dev/null || true)"
policy="$(docker exec "$API" printenv DOGRAH_STATE_CID_POLICY 2>/dev/null || true)"
prov=/app/api/services/telephony/providers/ari/provider.py
patched="$(docker exec "$API" grep -c HOPWHISTLE_ARI_TRUNK_V1 "$prov" 2>/dev/null || echo 0)"
echo "  ARI trunk patch loaded:   $([ "${patched:-0}" -gt 0 ] && echo yes || echo 'no (stock Dograh dials @fractel)')"
echo "  DOGRAH_ARI_TRUNK:         ${trunk:-(unset = fractel)}"
echo "  DOGRAH_ARI_TRANSFER_TRUNK:${xfer:+ }${xfer:-(unset = same as above)}"
echo "  DOGRAH_ARI_DIAL_PREFIX:   ${prefix:-(unset)}"
echo "  DOGRAH_STATE_CID_POLICY:  ${policy:-(unset = off)}"
if [ "${patched:-0}" -gt 0 ] && [ -n "$trunk" ] && [ "$trunk" != "fractel" ]; then
  problem "Dograh sends AI calls to the '$trunk' trunk, not FracTEL" trunk
fi
if [ -n "$prefix" ]; then
  problem "DOGRAH_ARI_DIAL_PREFIX=$prefix is set; FracTEL gets ${prefix}1XXXXXXXXXX and refuses it" prefix
fi

# ---------------------------------------------------------------------------
HDR "2. Telephony configurations and caller IDs (Dograh DB)"
docker exec "$API" rm -rf /tmp/hw-diag >/dev/null 2>&1
docker exec "$API" mkdir -p /tmp/hw-diag >/dev/null
docker cp deploy/dograh/anveo-trunk/set_caller_id_pool.py "$API:/tmp/hw-diag/" >/dev/null
docker exec "$API" python /tmp/hw-diag/set_caller_id_pool.py --list-configs 2>&1 | sed 's/^/  /'
dbout="$(docker exec -i "$API" python - "$TCID" <<'PY' 2>&1
import asyncio, json, os, sys
async def main():
    import asyncpg
    tcid = int(sys.argv[1])
    conn = await asyncpg.connect(dsn=os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://"))
    try:
        rows = await conn.fetch(
            "select coalesce(extra_metadata->>'pool','(none)') as pool, is_active, count(*) as n "
            "from telephony_phone_numbers where telephony_configuration_id=$1 group by 1,2 order by 1,2", tcid)
        for r in rows:
            print(f"POOL {r['pool']} {'active' if r['is_active'] else 'inactive'} {r['n']}")
        # Any column that holds a dial template, whatever this Dograh version calls it.
        cols = [r["column_name"] for r in await conn.fetch(
            "select column_name from information_schema.columns where table_name='telephony_configurations'")]
        row = await conn.fetchrow("select * from telephony_configurations where id=$1", tcid)
        if row:
            for c in cols:
                v = row[c]
                text = v if isinstance(v, str) else json.dumps(v, default=str) if v is not None else ""
                for piece in ("PJSIP/", "SIP/"):
                    i = text.find(piece)
                    if i >= 0:
                        end = text.find('"', i)
                        print(f"TEMPLATE {c} {text[i:end if end > 0 else i + 60]}")
                        break
    finally:
        await conn.close()
asyncio.run(main())
PY
)"
echo "$dbout" | grep -E '^(POOL|TEMPLATE)' | sed 's/^POOL /  caller IDs on config '"$TCID"': /; s/^TEMPLATE /  dial template: /'
echo "$dbout" | grep -vE '^(POOL|TEMPLATE)' | sed '/^$/d; s/^/  /'
active_total="$(echo "$dbout" | awk '$1=="POOL" && $3=="active"{s+=$4} END{print s+0}')"
active_anveo="$(echo "$dbout" | awk '$1=="POOL" && $2=="anveo" && $3=="active"{s+=$4} END{print s+0}')"
active_state="$(echo "$dbout" | awk '$1=="POOL" && $2=="state_cid" && $3=="active"{s+=$4} END{print s+0}')"
if echo "$dbout" | grep -q '^TEMPLATE' && ! echo "$dbout" | grep '^TEMPLATE' | grep -q '@fractel'; then
  problem "telephony config $TCID's dial template does not dial @fractel" template
fi
if [ "$active_total" -eq 0 ]; then
  problem "config $TCID has no active caller IDs, so Dograh has no number to call from" cid
elif [ "$active_anveo" -gt 0 ] && [ "$active_state" -eq 0 ]; then
  problem "only the Anveo caller IDs are active ($active_anveo); the FracTEL numbers were switched off" cid
fi
[ -f /root/anveo-pool-backup.json ] && YEL "  /root/anveo-pool-backup.json exists: set_caller_id_pool.py was applied at some point."

# ---------------------------------------------------------------------------
HDR "3. The fractel trunk in Asterisk"
ep="$(docker exec "$AST" asterisk -rx "pjsip show endpoint fractel" 2>&1)"
if echo "$ep" | grep -qE 'Endpoint:\s+fractel\b'; then
  GRN "  endpoint fractel is loaded"
  echo "$ep" | grep -iE '^\s*(aors|outbound_auth|from_user|from_domain|callerid|context|transport)\s*:' | sed -E 's/^\s*/  /'
  docker exec "$AST" asterisk -rx "pjsip show contacts" 2>&1 | grep -i fractel | sed 's/^/  /'
else
  problem "the fractel PJSIP endpoint is not loaded in $AST" endpoint
fi

# ---------------------------------------------------------------------------
HDR "4. Last 30 minutes of FracTEL / call errors"
echo "  -- $AST --"
docker logs --since 30m "$AST" 2>&1 \
  | grep -iE 'fractel|SIP/2\.0 [3456][0-9][0-9]|Got SIP response|rejected|Unable to create|No matching endpoint|Call to .* failed' \
  | tail -25 | sed 's/^/  /'
echo "  -- $API --"
docker logs --since 30m "$API" 2>&1 \
  | grep -iE 'NO_CALLER_ID|All from_numbers|from_number|originate|ari.*(error|fail)|telephony.*(error|fail)' \
  | tail -25 | sed 's/^/  /'

# ---------------------------------------------------------------------------
if [ -n "$TEST_TO" ]; then
  HDR "5. Test call straight through the fractel trunk"
  to="$(ten "$TEST_TO")"; cid="$(ten "$TEST_CID")"
  if [ -z "$to" ] || [ -z "$cid" ]; then
    RED "  --test-call and --caller-id must both be 10-digit US numbers (caller ID: one of the FracTEL DIDs)"
    exit 1
  fi
  # In-memory dialplan only (gone on reload/restart); nothing is written to disk.
  ctx=hw-fractel-test
  docker exec "$AST" asterisk -rx "dialplan add extension s,1,Set(CALLERID(num)=+1$cid) into $ctx replace" >/dev/null
  docker exec "$AST" asterisk -rx "dialplan add extension s,2,Dial(PJSIP/+1$to@fractel) into $ctx replace" >/dev/null
  docker exec "$AST" asterisk -rx "dialplan add extension s,3,Hangup() into $ctx replace" >/dev/null
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  docker exec "$AST" asterisk -rx "channel originate Local/s@$ctx/n application Playback tt-monkeys" | sed 's/^/  /'
  echo "  calling +1$to from +1$cid ... (watching 25s)"
  sleep 25
  docker logs --since "$since" "$AST" 2>&1 | grep -iE 'fractel|SIP/2\.0|Got SIP response|failed|busy|congest|answer' | tail -25 | sed 's/^/  /'
  docker exec "$AST" asterisk -rx "dialplan remove context $ctx" >/dev/null 2>&1
  echo "  If your phone rang: FracTEL works, so the cause is a Dograh setting above."
  echo "  If not: the log lines above are FracTEL's answer (403 = source IP / caller ID not"
  echo "  authorised on FracTEL device 576613142989; 404/484 = number format; no reply = network)."
fi

docker exec "$API" rm -rf /tmp/hw-diag >/dev/null 2>&1

# ---------------------------------------------------------------------------
HDR "Verdict"
if [ "${#PROBLEMS[@]}" -eq 0 ]; then
  GRN "  Dograh is set to dial FracTEL with FracTEL caller IDs."
  [ -z "$TEST_TO" ] && echo "  Next: run again with --test-call <your cell> --caller-id <a FracTEL DID>."
  exit 0
fi
shown=" "
for p in "${PROBLEMS[@]}"; do
  msg="${p%|*}"; kind="${p##*|}"
  RED "* $msg"
  [ "$kind" = prefix ] && kind=trunk   # one fix covers both
  case "$shown" in *" $kind "*) continue ;; esac
  shown="$shown$kind "
  case "$kind" in
    trunk)
      cat <<'EOF'
    Fix: in /opt/dograh/docker-compose.override.yaml, under every Dograh API service,
    set   DOGRAH_ARI_TRUNK: fractel   and delete the DOGRAH_ARI_DIAL_PREFIX and
    DOGRAH_ARI_TRANSFER_TRUNK lines (if present). Then:
      cd /opt/dograh && docker compose config >/dev/null && docker compose up -d --no-deps api
EOF
      ;;
    template)
      echo "    Fix: in Dograh, Telephony -> this configuration, set the dial template to  PJSIP/{number}@fractel"
      ;;
    cid)
      cat <<'EOF'
    Fix: undo the Anveo caller-ID switch, then make sure every FracTEL number is active:
      docker cp deploy/dograh/anveo-trunk/set_caller_id_pool.py dograh-api-1:/tmp/
      docker cp /root/anveo-pool-backup.json dograh-api-1:/tmp/anveo-pool-backup.json
      docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --restore /tmp/anveo-pool-backup.json          # dry run
      docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --restore /tmp/anveo-pool-backup.json --apply
      ./sync-dograh-caller-ids.sh --apply
EOF
      ;;
    endpoint)
      echo "    Fix: the fractel section is missing from dograh-asterisk's pjsip.conf; restore it from a .bak-hopwhistle-* copy next to it."
      ;;
  esac
done
exit 2
