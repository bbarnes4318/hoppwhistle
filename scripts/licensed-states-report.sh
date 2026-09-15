#!/usr/bin/env bash
# Is this database ready for AGENT licensed-state enforcement? Read-only.
#
# ── What it answers ──────────────────────────────────────────────────────────
#
# PR #120 makes an AGENT's access conditional on the states they are licensed in,
# and it defaults to deny: an agent with no licence performs no state-authorized
# operation, and a lead with no readable state is served to no agent. That is the
# correct rule, and on a database that has never recorded a licence it means every
# agent starts with nothing.
#
# There is nothing to infer it from. No column in this schema records an agent's
# insurance licence; every `state` the database holds belongs to a prospect, an
# applicant, a buyer's routing preference, or the agency's single home state.
# So this does not propose licences. It reports who has none, so that somebody
# who knows the real answer can set them with
#
#   pnpm --filter @hopwhistle/api agents:licenses -- --set <email> TN,FL
#
# before the deploy rather than after the support calls.
#
# ── It writes nothing ────────────────────────────────────────────────────────
#
# Every statement is a SELECT. It creates no table, not even a temporary one, and
# is safe to run against production — which is the only place worth running it.
#
# Usage:
#   scripts/licensed-states-report.sh                    # DATABASE_URL from apps/api/.env
#   scripts/licensed-states-report.sh --url "postgresql://…"
#   scripts/licensed-states-report.sh --csv-dir ./out    # also write each section as CSV
#
# Exit status: 0 ready to deploy, 1 configuration needed first, 2 could not tell.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RED()  { printf "\033[31m%s\033[0m\n" "$*" >&2; }
YEL()  { printf "\033[33m%s\033[0m\n" "$*"; }
GRN()  { printf "\033[32m%s\033[0m\n" "$*"; }
HEAD() { printf "\n\033[1m── %s\033[0m\n" "$*"; }

URL=""
CSV_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url)     URL="${2:-}"; shift 2 ;;
    --csv-dir) CSV_DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) RED "unknown argument: $1"; exit 2 ;;
  esac
done

command -v psql >/dev/null 2>&1 || { RED "psql is not on PATH."; exit 2; }

if [ -z "$URL" ]; then
  if [ -s "$ROOT/apps/api/.env" ]; then
    set -a; . "$ROOT/apps/api/.env"; set +a
  fi
  URL="${DATABASE_URL:-}"
fi
[ -n "$URL" ] || { RED "No DATABASE_URL. Pass --url or set it in apps/api/.env."; exit 2; }

# Prisma's DATABASE_URL carries `?schema=public`, and psql rejects it outright:
#   psql: error: invalid URI query parameter: "schema"
# Every URL in this repository is written for Prisma, so the one the operator
# already has in apps/api/.env would fail here for a reason that says nothing
# about the database. Dropped rather than passed through; this report only ever
# reads the default search_path.
URL="${URL%%\?schema=*}"

psql "$URL" -tAc 'select 1' >/dev/null 2>&1 || {
  RED "Could not reach the database. Nothing was read."; exit 2; }

[ -n "$CSV_DIR" ] && mkdir -p "$CSV_DIR"

q() {
  local id="$1" sql="$2"
  psql "$URL" -v ON_ERROR_STOP=1 --pset=footer=off -c "$sql" 2>&1
  if [ -n "$CSV_DIR" ]; then
    psql "$URL" -v ON_ERROR_STOP=1 --csv -c "$sql" > "$CSV_DIR/$id.csv" 2>/dev/null
  fi
}

num() {
  local c; c="$(psql "$URL" -tAc "$1" 2>/dev/null | tr -d '[:space:]')"
  case "$c" in ''|*[!0-9]*) c=0 ;; esac
  printf '%s' "$c"
}

# The 50 states, DC and the five territories -- the same set
# `lib/licensed-states.ts` will enforce against. A value outside it grants or
# matches nothing, whatever it says.
JURISDICTIONS="'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP'"

echo "licensed-states-report — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "database: $(psql "$URL" -tAc 'select current_database()' | tr -d '[:space:]')"
echo "read-only: every statement below is a SELECT."

# ═════════════════════════════════════════════════════════════════════════════
HEAD "1. Every AGENT, and the licence they hold today"
# ═════════════════════════════════════════════════════════════════════════════
echo "'licensed_states' is what enforcement will read. NULL means the key is absent."
q agents "
SELECT u.email,
       t.name                                   AS agency,
       u.status,
       u.metadata -> 'licensedStates'           AS licensed_states,
       jsonb_typeof(u.metadata -> 'licensedStates') AS stored_as
FROM users u
JOIN user_roles ur ON ur.\"userId\" = u.id
JOIN roles r       ON r.id = ur.\"roleId\" AND r.name = 'AGENT'
LEFT JOIN tenants t ON t.id = u.\"tenantId\"
ORDER BY t.name NULLS FIRST, u.email;"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "2. AGENTs who would be blocked by the deploy"
# ═════════════════════════════════════════════════════════════════════════════
echo "Each of these performs NO state-authorized operation until a licence is set."
q agents-blocked "
WITH agents AS (
  SELECT u.id, u.email, t.name AS agency, u.metadata -> 'licensedStates' AS ls
  FROM users u
  JOIN user_roles ur ON ur.\"userId\" = u.id
  JOIN roles r       ON r.id = ur.\"roleId\" AND r.name = 'AGENT'
  LEFT JOIN tenants t ON t.id = u.\"tenantId\"
)
SELECT email, agency,
       CASE
         WHEN ls IS NULL                  THEN 'no licensedStates key'
         WHEN jsonb_typeof(ls) <> 'array' THEN 'not an array: ' || ls::text
         WHEN jsonb_array_length(ls) = 0  THEN 'empty array'
         ELSE 'no entry is a US state: ' || ls::text
       END AS why
FROM agents
WHERE ls IS NULL
   OR jsonb_typeof(ls) <> 'array'
   OR jsonb_array_length(ls) = 0
   OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(ls) AS e(v)
        WHERE upper(trim(v)) IN ($JURISDICTIONS)
      )
ORDER BY agency NULLS FIRST, email;"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "3. Licence entries enforcement cannot read"
# ═════════════════════════════════════════════════════════════════════════════
echo "Stored, but not a jurisdiction — dropped on read, so they grant nothing."
q licence-entries-rotten "
SELECT u.email, e.v AS entry
FROM users u
JOIN user_roles ur ON ur.\"userId\" = u.id
JOIN roles r       ON r.id = ur.\"roleId\" AND r.name = 'AGENT'
CROSS JOIN LATERAL jsonb_array_elements_text(u.metadata -> 'licensedStates') AS e(v)
WHERE jsonb_typeof(u.metadata -> 'licensedStates') = 'array'
  AND upper(trim(e.v)) NOT IN ($JURISDICTIONS)
ORDER BY u.email, e.v;"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "4. AGENT-owned leads, by the state they carry"
# ═════════════════════════════════════════════════════════════════════════════
echo "A lead with no readable state is served to NO agent, however they are licensed."
q lead-state-health "
SELECT COALESCE(t.name, '(no agency)') AS agency,
       CASE
         WHEN l.state IS NULL           THEN 'NULL'
         WHEN trim(l.state) = ''        THEN 'empty'
         WHEN upper(trim(l.state)) IN ($JURISDICTIONS) THEN 'valid'
         ELSE 'unreadable'
       END AS state_health,
       count(*) AS leads
FROM insurance_leads l
LEFT JOIN tenants t ON t.id = l.\"tenantId\"
WHERE l.\"assignedToId\" IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "5. The unreadable state values actually present"
# ═════════════════════════════════════════════════════════════════════════════
echo "What cleanup would have to resolve. Each is a literal value in the column."
q lead-state-values "
SELECT l.state AS stored_value, count(*) AS leads
FROM insurance_leads l
WHERE l.\"assignedToId\" IS NOT NULL
  AND (l.state IS NULL OR upper(trim(l.state)) NOT IN ($JURISDICTIONS))
GROUP BY l.state
ORDER BY leads DESC, stored_value NULLS FIRST;"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "6. Can an unreadable lead state be repaired from its source record?"
# ═════════════════════════════════════════════════════════════════════════════
echo "InsuranceLeadSubmission.rawPayload is the original inbound JSON, kept verbatim."
echo "Where it carries a state the column does not, the column can be repaired FROM"
echo "THE SOURCE rather than guessed. Where it does not, the lead needs the vendor."
q lead-state-repairable "
WITH broken AS (
  SELECT l.id, l.state AS column_value
  FROM insurance_leads l
  WHERE l.\"assignedToId\" IS NOT NULL
    AND (l.state IS NULL OR upper(trim(l.state)) NOT IN ($JURISDICTIONS))
),
src AS (
  SELECT b.id,
         b.column_value,
         (SELECT COALESCE(s.\"rawPayload\" ->> 'state', s.\"rawPayload\" ->> 'State')
          FROM insurance_lead_submissions s
          WHERE s.\"insuranceLeadId\" = b.id
          ORDER BY s.\"receivedAt\" ASC
          LIMIT 1) AS raw_state
  FROM broken b
)
SELECT COALESCE(raw_state, '(none in rawPayload)') AS source_value,
       CASE
         WHEN raw_state IS NULL OR trim(raw_state) = '' THEN 'no source — needs the vendor'
         WHEN upper(trim(raw_state)) IN ($JURISDICTIONS) THEN 'repairable from source'
         ELSE 'source is a name or junk — needs a resolver, not a guess'
       END AS verdict,
       count(*) AS leads
FROM src
GROUP BY 1, 2
ORDER BY leads DESC;"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "Verdict"
# ═════════════════════════════════════════════════════════════════════════════

AGENTS="$(num "
SELECT count(DISTINCT u.id) FROM users u
JOIN user_roles ur ON ur.\"userId\" = u.id
JOIN roles r ON r.id = ur.\"roleId\" AND r.name = 'AGENT';")"

BLOCKED="$(num "
WITH agents AS (
  SELECT u.id, u.metadata -> 'licensedStates' AS ls FROM users u
  JOIN user_roles ur ON ur.\"userId\" = u.id
  JOIN roles r ON r.id = ur.\"roleId\" AND r.name = 'AGENT'
)
SELECT count(*) FROM agents
WHERE ls IS NULL OR jsonb_typeof(ls) <> 'array' OR jsonb_array_length(ls) = 0
   OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(ls) AS e(v)
                  WHERE upper(trim(v)) IN ($JURISDICTIONS));")"

LEADS_BAD="$(num "
SELECT count(*) FROM insurance_leads l
WHERE l.\"assignedToId\" IS NOT NULL
  AND (l.state IS NULL OR upper(trim(l.state)) NOT IN ($JURISDICTIONS));")"

LEADS_OK="$(num "
SELECT count(*) FROM insurance_leads l
WHERE l.\"assignedToId\" IS NOT NULL
  AND upper(trim(l.state)) IN ($JURISDICTIONS);")"

echo "AGENT accounts:                    $AGENTS"
echo "  … with a usable licence:         $((AGENTS - BLOCKED))"
echo "  … blocked until one is set:      $BLOCKED"
echo "AGENT-owned leads with a state:    $LEADS_OK"
echo "AGENT-owned leads without one:     $LEADS_BAD"

STATUS=0

if [ "$BLOCKED" -gt 0 ]; then
  RED "NOT READY: $BLOCKED of $AGENTS agents would have no access after the deploy."
  echo "  Set each one's real licence — this is typed in, never inferred:"
  echo "    pnpm --filter @hopwhistle/api agents:licenses -- --set <email> TN,FL"
  STATUS=1
else
  GRN "Every AGENT holds a usable licence."
fi

if [ "$LEADS_BAD" -gt 0 ]; then
  YEL "$LEADS_BAD assigned lead(s) carry no readable state and will reach no agent."
  echo "  These need data cleanup, from the source the lead arrived from. Do not"
  echo "  guess a state to make a lead visible — section 5 lists what is stored."
  [ "$STATUS" -eq 0 ] && STATUS=1
fi

exit "$STATUS"
