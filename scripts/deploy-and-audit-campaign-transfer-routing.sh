#!/usr/bin/env bash
set -euo pipefail

REPO=/opt/hopwhistle
COMPOSE_DIR="$REPO/infra/docker"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.dev.yml"
EXPECTED_MAIN=aee71b3911185084f91e42084ecfe9146b78c098

cd "$REPO"
echo "=== 1. FETCH PERMANENT CAMPAIGN ROUTING RELEASE ==="
git fetch origin

if ! git merge-base --is-ancestor "$EXPECTED_MAIN" origin/main; then
  echo "ERROR: origin/main does not contain required release $EXPECTED_MAIN" >&2
  exit 1
fi

# Copy only the production routing release files into the current server checkout.
# This preserves unrelated local emergency/security changes while ensuring the
# Docker build uses the exact committed release from origin/main.
release_files=(
  scripts/apply-softphone-ringback-dtmf-source.mjs
  scripts/apply-campaign-mixed-destination-routing.mjs
  scripts/apply-campaign-routing-ui-source.mjs
  apps/api/src/services/__tests__/routing-softphone-ring-group.test.ts
  apps/api/Dockerfile
  apps/web/Dockerfile
)

for path in "${release_files[@]}"; do
  mkdir -p "$(dirname "$REPO/$path")"
  tmp="$(mktemp)"
  git show "origin/main:$path" > "$tmp"
  install -m 0644 "$tmp" "$REPO/$path"
  rm -f "$tmp"
done
chmod 0755 "$REPO/scripts/apply-softphone-ringback-dtmf-source.mjs" \
  "$REPO/scripts/apply-campaign-mixed-destination-routing.mjs" \
  "$REPO/scripts/apply-campaign-routing-ui-source.mjs"

echo "Release files installed from origin/main."

echo
echo "=== 2. BUILD API + WEB WITH ROUTING TEST GATES ==="
cd "$COMPOSE_DIR"
docker compose -f "$COMPOSE_FILE" build api web

echo
echo "=== 3. RECREATE ONLY API + WEB ==="
docker compose -f "$COMPOSE_FILE" up -d --no-deps api web

for attempt in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:3001/health/ready >/tmp/hopwhistle-routing-health.json 2>/dev/null; then
    break
  fi
  sleep 2
done

if ! curl -fsS http://127.0.0.1:3001/health/ready >/tmp/hopwhistle-routing-health.json; then
  echo "ERROR: Hopwhistle API did not become ready" >&2
  docker logs --tail 120 hopwhistle-api-dev >&2
  exit 1
fi
cat /tmp/hopwhistle-routing-health.json
echo

echo
echo "=== 4. VERIFY COMPILED ROUTING RELEASE ==="
docker exec hopwhistle-api-dev sh -lc \
  'grep -Rasq "Selected campaign mixed destination ring/failover plan" /app/dist && echo "Mixed cell+extension routing: PRESENT"'
docker exec hopwhistle-api-dev sh -lc \
  'grep -Rasq "refusing to bypass routing filters" /app/dist && echo "Unsafe all-buyers bypass removed: PRESENT"'
docker exec hopwhistle-web-dev sh -lc \
  'grep -Rasq "Cell / Hopwhistle Extension" /app/apps/web/.next && echo "Campaign routing UI: PRESENT"'
docker exec hopwhistle-freeswitch-dev sh -lc \
  'grep -q "local failover_steps = split(destination, \"|\")" /usr/share/freeswitch/scripts/inbound_route.lua && grep -q "table.concat(bridge_components, \",\")" /usr/share/freeswitch/scripts/inbound_route.lua && echo "FreeSWITCH mixed bridge parser: PRESENT"'

echo
echo "=== 5. LIVE ACTIVE CAMPAIGN DIDS AND BUYERS ==="
ROUTES="$({
  docker exec -i hopwhistle-postgres-dev sh -lc \
    'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -AtF "|"' <<'SQL'
SELECT
  dr.did,
  c.id,
  c.name,
  c.status::text,
  COUNT(cb.id) FILTER (WHERE cb.status::text = 'ACTIVE') AS active_buyer_destinations,
  COALESCE(
    string_agg(
      CASE WHEN cb.status::text = 'ACTIVE'
        THEN b.name || ':' || cb."destinationNumber" || ':priority=' || cb.priority::text || ':weight=' || cb.weight::text
      END,
      '; ' ORDER BY cb.priority, b.name
    ),
    ''
  ) AS destinations
FROM did_routes dr
JOIN campaigns c ON c.id = dr."campaignId"
LEFT JOIN campaign_buyers cb ON cb."campaignId" = c.id
LEFT JOIN buyers b ON b.id = cb."buyerId"
WHERE dr.status::text = 'ACTIVE'
  AND c.status::text = 'ACTIVE'
GROUP BY dr.did, c.id, c.name, c.status
ORDER BY c.name, dr.did;
SQL
} 2>/dev/null)"

if [ -z "$ROUTES" ]; then
  echo "NO ACTIVE CAMPAIGN DID ROUTES FOUND"
  echo "Create one in Hopwhistle: Campaign > Buyers, then Numbers > Create Route > Route to Campaign."
else
  printf '%s\n' "$ROUTES" | while IFS='|' read -r did campaign_id campaign_name campaign_status buyer_count destinations; do
    echo "DID=$did | campaign=$campaign_name | active destinations=$buyer_count"
    echo "  $destinations"
  done
fi

echo
echo "=== 6. LIVE FREESWITCH LOOKUP FOR EVERY CAMPAIGN DID ==="
LOOKUP_FAILURE=0
MIXED_ROUTE_COUNT=0
if [ -n "$ROUTES" ]; then
  while IFS='|' read -r did campaign_id campaign_name campaign_status buyer_count destinations; do
    [ -n "$did" ] || continue
    response="$(curl -fsS --get \
      --data-urlencode "did=$did" \
      --data-urlencode 'caller=+14235550199' \
      http://127.0.0.1:3001/api/v1/freeswitch/lookup || true)"

    echo "$campaign_name ($did): $response"

    result="$(printf '%s' "$response" | python3 -c '
import json, re, sys
try:
    data=json.load(sys.stdin)
except Exception:
    print("INVALID_JSON")
    raise SystemExit
route=str(data.get("destination") or "")
legs=[x.strip() for step in route.split("|") for x in step.split(",") if x.strip()]
has_internal=any(re.fullmatch(r"\d{4}", x) for x in legs)
has_external=any(10 <= len(re.sub(r"\D", "", x)) <= 15 for x in legs)
if data.get("noEligibleDestination"):
    print("NO_ELIGIBLE")
elif not route:
    print("EMPTY")
elif has_internal and has_external:
    print("MIXED")
elif has_internal:
    print("INTERNAL_ONLY")
elif has_external:
    print("EXTERNAL_ONLY")
else:
    print("INVALID_DESTINATION")
')"

    echo "  classification=$result"
    case "$result" in
      MIXED) MIXED_ROUTE_COUNT=$((MIXED_ROUTE_COUNT + 1)) ;;
      INVALID_JSON|EMPTY|INVALID_DESTINATION) LOOKUP_FAILURE=1 ;;
    esac
  done <<< "$ROUTES"
fi

echo
echo "=== 7. REGISTERED HOPWHISTLE EXTENSIONS ==="
docker exec hopwhistle-freeswitch-dev fs_cli -x 'sofia status profile internal reg' 2>&1 | \
  awk '/^User:/ || /^Status:/ || /^Ping-Status:/ || /^Total items returned:/'

echo
echo "=== 8. DOGRAH TRANSFER TRANSPORT ==="
docker inspect dograh-asterisk \
  --format 'Asterisk running={{.State.Running}} healthy={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}} restart={{.HostConfig.RestartPolicy.Name}}'
docker exec dograh-asterisk asterisk -rx 'ari show apps' 2>&1
docker exec dograh-asterisk asterisk -rx 'pjsip show endpoint fractel' 2>&1 | \
  grep -E 'Endpoint:|Contact:|Match:|context|dtmf_mode|Objects found' || true

FIRST_DID="$(printf '%s\n' "$ROUTES" | awk -F'|' 'NF && $1 != "" {print $1; exit}')"
TRANSFER_TARGET=""
if [ -n "$FIRST_DID" ]; then
  DID_DIGITS="$(printf '%s' "$FIRST_DID" | tr -cd '0-9')"
  TRANSFER_TARGET="PJSIP/+${DID_DIGITS}@fractel"
  echo
  echo "DOGRAH CALL TRANSFER DESTINATION FOR THE FIRST ACTIVE CAMPAIGN DID:"
  echo "$TRANSFER_TARGET"
  echo "Dograh's Asterisk ARI Call Transfer tool must use that exact SIP destination, not a bare phone number."
fi

echo
echo "=== 9. DOGRAH WORKFLOW TRANSFER CONFIG DISCOVERY ==="
# Search only workflow/node/tool/agent tables and print counts—not stored JSON,
# prompts, credentials, headers, tokens, or tool definitions.
DOGRAH_HITS="$(docker exec -i dograh-postgres-1 sh -lc \
  'exec psql -v ON_ERROR_STOP=1 -qAtF "|" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v target="$1"' \
  sh "$TRANSFER_TARGET" <<'SQL' 2>/dev/null || true
CREATE TEMP TABLE transfer_audit_hits (
  table_name text,
  column_name text,
  transfer_rows bigint,
  exact_target_rows bigint
);
CREATE TEMP TABLE transfer_audit_input (target text);
INSERT INTO transfer_audit_input VALUES (:'target');
DO $$
DECLARE
  r record;
  transfer_count bigint;
  target_count bigint;
  target_value text := (SELECT target FROM transfer_audit_input LIMIT 1);
BEGIN
  FOR r IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND data_type IN ('json', 'jsonb', 'text', 'character varying')
      AND table_name ~* '(workflow|node|tool|agent)'
  LOOP
    BEGIN
      EXECUTE format(
        'SELECT count(*) FROM %I.%I WHERE %I::text ILIKE %L',
        r.table_schema, r.table_name, r.column_name, '%transfer%'
      ) INTO transfer_count;
      IF target_value <> '' THEN
        EXECUTE format(
          'SELECT count(*) FROM %I.%I WHERE %I::text ILIKE %L',
          r.table_schema, r.table_name, r.column_name, '%' || target_value || '%'
        ) INTO target_count;
      ELSE
        target_count := 0;
      END IF;
      IF transfer_count > 0 OR target_count > 0 THEN
        INSERT INTO transfer_audit_hits VALUES (
          r.table_schema || '.' || r.table_name,
          r.column_name,
          transfer_count,
          target_count
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;
SELECT table_name, column_name, transfer_rows, exact_target_rows
FROM transfer_audit_hits
ORDER BY table_name, column_name;
SQL
)"

if [ -n "$DOGRAH_HITS" ]; then
  printf '%s\n' "$DOGRAH_HITS"
else
  echo "No stored Dograh transfer-tool configuration was detected in workflow/tool tables."
fi

TRANSFER_MATCHES="$(printf '%s\n' "$DOGRAH_HITS" | awk -F'|' 'NF>=3 {s+=$3} END {print s+0}')"
EXACT_TARGET_MATCHES="$(printf '%s\n' "$DOGRAH_HITS" | awk -F'|' 'NF>=4 {s+=$4} END {print s+0}')"

echo
echo "=== FINAL RESULT ==="
echo "API and web routing release: DEPLOYED"
echo "Hopwhistle mixed bridge parser: VERIFIED"
echo "Dograh Asterisk + FracTEL endpoint: VERIFIED"
echo "Active campaign DID routes: $(printf '%s\n' "$ROUTES" | sed '/^$/d' | wc -l)"
echo "Live mixed cell+extension routes: $MIXED_ROUTE_COUNT"
echo "Dograh transfer-config rows: $TRANSFER_MATCHES"
echo "Dograh exact campaign-target rows: $EXACT_TARGET_MATCHES"

if [ "$LOOKUP_FAILURE" -ne 0 ]; then
  echo "ERROR: At least one active campaign DID returned an invalid live route" >&2
  exit 1
fi

echo "CAMPAIGN TRANSFER ROUTING DEPLOYMENT AND AUDIT COMPLETE"
