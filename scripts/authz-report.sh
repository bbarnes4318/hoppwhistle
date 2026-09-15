#!/usr/bin/env bash
# Who holds what, and how they came to hold it. Read-only.
#
# ── Why this exists ──────────────────────────────────────────────────────────
#
# docs/AGENT_AUTHORIZATION_AUDIT.md traced a reported incident — a new agent
# account that could see everything a Company Admin could, and ~20 minutes later
# could see only a Dashboard — and established that NO server-side path can turn
# an AGENT into an ADMIN. The token carries no roles, `lib/principal.ts` replaces
# them from `user_roles` on every request, and the activation grant names the
# role.
#
# That leaves the data. Two artefacts in this repository produce the reported
# sequence exactly:
#
#   scripts/quarantine/seed-admin-roles.sql   grants ADMIN to EVERY row in users
#   scripts/quarantine/demote-user.sql        removes ADMIN, assigns nothing
#
# and one mechanism in the code can degrade a live session over wall-clock time:
# the rate limiter keys on `request.ip`, which is nginx (127.0.0.1) because
# Fastify is built without `trustProxy`, so the whole platform shares one
# 100-req/min bucket. A 429 on /api/auth/me leaves the client with no user.
#
# This script decides between them from production data instead of by argument,
# and inventories the role damage that has to be repaired either way.
#
# ── It writes nothing ────────────────────────────────────────────────────────
#
# Every statement is a SELECT. It creates no table, not even a temporary one. It
# is meant to be run against production, which is the only place worth running
# it. Run it before changing a single role row.
#
# Usage:
#   scripts/authz-report.sh                      # DATABASE_URL from apps/api/.env
#   scripts/authz-report.sh --url "postgresql://…"
#   scripts/authz-report.sh --email someone@agency.com   # focus one account
#   scripts/authz-report.sh --csv-dir ./out      # also write each section as CSV
#
# Exit status: 0 nothing to repair, 1 findings to repair, 2 could not tell.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RED()  { printf "\033[31m%s\033[0m\n" "$*" >&2; }
YEL()  { printf "\033[33m%s\033[0m\n" "$*"; }
GRN()  { printf "\033[32m%s\033[0m\n" "$*"; }
HEAD() { printf "\n\033[1m── %s\033[0m\n" "$*"; }

URL=""
EMAIL=""
CSV_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url)     URL="${2:-}"; shift 2 ;;
    --email)   EMAIL="${2:-}"; shift 2 ;;
    --csv-dir) CSV_DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
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

psql "$URL" -tAc 'select 1' >/dev/null 2>&1 || {
  RED "Could not reach the database. Nothing was read."; exit 2; }

[ -n "$CSV_DIR" ] && mkdir -p "$CSV_DIR"

# Run one query. $1 is a section id (also the CSV basename), $2 the SQL.
# Aligned output for a person; CSV alongside it when --csv-dir is given.
q() {
  local id="$1" sql="$2"
  psql "$URL" -v ON_ERROR_STOP=1 --pset=footer=off -c "$sql" 2>&1
  if [ -n "$CSV_DIR" ]; then
    psql "$URL" -v ON_ERROR_STOP=1 --csv -c "$sql" > "$CSV_DIR/$id.csv" 2>/dev/null
  fi
}

# Scalar, for the findings tally.
n() { psql "$URL" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

FINDINGS=0

# A count, as a number. Deliberately NOT a function that also updates the
# tally: every call site is `$(...)`, which runs in a subshell, so an increment
# made inside one is discarded when it exits — the report printed its findings
# and then exited 0 as though the database were clean. The counts are taken
# into variables first and added up here, in this shell.
num() {
  local c; c="$(psql "$URL" -tAc "$1" 2>/dev/null | tr -d '[:space:]')"
  case "$c" in ''|*[!0-9]*) c=0 ;; esac
  printf '%s' "$c"
}

echo "authz-report — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "database: $(psql "$URL" -tAc 'select current_database()' | tr -d '[:space:]')"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "1. Role inventory — every account, its tenant, and its roles"
# ═════════════════════════════════════════════════════════════════════════════
q roles-by-account "
SELECT u.email,
       t.name                                   AS tenant,
       u.status,
       COALESCE(string_agg(r.name::text, ',' ORDER BY r.name::text), '(none)') AS roles,
       u.\"createdAt\"::date                      AS created,
       u.\"lastLoginAt\"::date                     AS last_login
FROM users u
LEFT JOIN tenants t    ON t.id = u.\"tenantId\"
LEFT JOIN user_roles ur ON ur.\"userId\" = u.id
LEFT JOIN roles r       ON r.id = ur.\"roleId\"
GROUP BY u.email, t.name, u.status, u.\"createdAt\", u.\"lastLoginAt\"
ORDER BY t.name NULLS FIRST, u.email;"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "2. Was a role granted LONG AFTER the account was created?"
# ═════════════════════════════════════════════════════════════════════════════
# This is the discriminating question for the incident. Registration and the
# invite endpoint both write the user row and its role in the same request, so a
# legitimate grant lands within seconds. A grant hours or days later was made by
# something else — a hand-run INSERT is the candidate named in the audit.
echo "A legitimate grant lands seconds after the user row. A large gap was written by something else."
q late-grants "
SELECT u.email,
       r.name::text                                          AS role,
       u.\"createdAt\"                                         AS user_created,
       ur.\"createdAt\"                                        AS role_granted,
       age(ur.\"createdAt\", u.\"createdAt\")                    AS gap
FROM user_roles ur
JOIN users u ON u.id = ur.\"userId\"
JOIN roles r ON r.id = ur.\"roleId\"
WHERE ur.\"createdAt\" > u.\"createdAt\" + interval '5 minutes'
ORDER BY gap DESC;"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "3. The fingerprint of the quarantined bulk-grant SQL"
# ═════════════════════════════════════════════════════════════════════════════
# That script inserts literal ids: user_roles.id = 'ur-' || u.id, roleId
# 'role-admin'. Every id the application writes is a uuid (@default(uuid())), so
# a row in either shape was not written by this application. This is the single
# most direct piece of evidence available.
q hand-written-rows "
SELECT ur.id             AS user_role_id,
       u.email,
       r.name::text      AS role,
       ur.\"createdAt\"
FROM user_roles ur
JOIN users u ON u.id = ur.\"userId\"
JOIN roles r ON r.id = ur.\"roleId\"
WHERE ur.id LIKE 'ur-%'
   OR ur.\"roleId\" IN ('role-admin','role-owner','role-agent','role-buyer')
ORDER BY ur.\"createdAt\";"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "4. Accounts that must be repaired"
# ═════════════════════════════════════════════════════════════════════════════

echo
echo "4a. ACTIVE accounts with NO role at all — the Dashboard-only end state:"
q roleless-active "
SELECT u.email, t.name AS tenant, u.status, u.\"createdAt\"::date AS created,
       u.\"lastLoginAt\"::date AS last_login
FROM users u
LEFT JOIN tenants t ON t.id = u.\"tenantId\"
WHERE u.status = 'ACTIVE'
  AND u.\"tenantId\" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.\"userId\" = u.id)
ORDER BY u.\"createdAt\";"

echo
echo "4b. Accounts holding ADMIN or OWNER *alongside* AGENT — an agent with admin authority:"
q agent-with-admin "
SELECT u.email, t.name AS tenant,
       string_agg(r.name::text, ',' ORDER BY r.name::text) AS roles
FROM users u
JOIN user_roles ur ON ur.\"userId\" = u.id
JOIN roles r       ON r.id = ur.\"roleId\"
LEFT JOIN tenants t ON t.id = u.\"tenantId\"
GROUP BY u.email, t.name
HAVING bool_or(r.name::text = 'AGENT')
   AND bool_or(r.name::text IN ('ADMIN','OWNER'))
ORDER BY t.name, u.email;"

echo
echo "4c. Duplicate / conflicting role rows (the unique index should make this empty):"
q duplicate-roles "
SELECT u.email, r.name::text AS role, count(*) AS rows
FROM user_roles ur
JOIN users u ON u.id = ur.\"userId\"
JOIN roles r ON r.id = ur.\"roleId\"
GROUP BY u.email, r.name::text
HAVING count(*) > 1
ORDER BY count(*) DESC;"

echo
echo "4d. ANALYST accounts — the current default of POST /api/v1/users/invite."
echo "    Each needs a deliberate decision before the default changes. Not a bulk convert."
q analyst-accounts "
SELECT u.email, t.name AS tenant, u.status,
       u.\"createdAt\"::date  AS created,
       u.\"lastLoginAt\"::date AS last_login,
       (u.metadata->>'invitedBy') IS NOT NULL AS was_invited,
       string_agg(r.name::text, ',' ORDER BY r.name::text) AS all_roles
FROM users u
JOIN user_roles ur ON ur.\"userId\" = u.id
JOIN roles r       ON r.id = ur.\"roleId\"
LEFT JOIN tenants t ON t.id = u.\"tenantId\"
GROUP BY u.email, t.name, u.status, u.\"createdAt\", u.\"lastLoginAt\", u.metadata
HAVING bool_or(r.name::text = 'ANALYST')
ORDER BY t.name, u.email;"

echo
echo "4e. PlatformAdmin rows — cross-agency capability. Every one should be a known operator:"
q platform-admins "
SELECT u.email, u.\"tenantId\" AS home_tenant, pa.\"grantedBy\", pa.note,
       pa.\"grantedAt\"
FROM platform_admins pa
JOIN users u ON u.id = pa.\"userId\"
ORDER BY pa.\"grantedAt\";"

echo
echo "4f. Roles the application expects but the database does not have."
echo "    A missing row makes assignGrantedRole() a silent no-op — an account with no role."
q missing-roles "
SELECT expected AS missing_role
FROM unnest(ARRAY['OWNER','ADMIN','AGENT','ANALYST','PUBLISHER','BUYER','READONLY']) AS expected
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.name::text = expected);"

# ═════════════════════════════════════════════════════════════════════════════
HEAD "5. The other candidate: the shared rate-limit bucket"
# ═════════════════════════════════════════════════════════════════════════════
# Fastify is built without `trustProxy`, so `request.ip` is nginx for every
# request. Two observable consequences, both visible here.
echo
echo "5a. Distinct client IPs in the audit log. All-loopback confirms trustProxy is off:"
q audit-ips "
SELECT COALESCE(\"ipAddress\", '(null)') AS ip_address, count(*) AS rows,
       min(\"createdAt\")::date AS first_seen, max(\"createdAt\")::date AS last_seen
FROM audit_logs
GROUP BY \"ipAddress\"
ORDER BY count(*) DESC
LIMIT 20;"

echo
echo "5b. Rate-limit refusals. A cluster during a shift is the shared-bucket symptom:"
q rate-limit-hits "
SELECT date_trunc('hour', \"createdAt\") AS hour, count(*) AS refusals
FROM audit_logs
WHERE action = 'rate_limit.exceeded'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 24;"

echo
echo "5c. Authorization denials by account — what each was actually refused, and when:"
q authorization-denied "
SELECT u.email, a.action, a.resource, a.error, a.\"createdAt\"
FROM audit_logs a
LEFT JOIN users u ON u.id = a.\"userId\"
WHERE a.action IN ('authorization.denied','rate_limit.exceeded','auth.jwt.invalid')
ORDER BY a.\"createdAt\" DESC
LIMIT 50;"

# ═════════════════════════════════════════════════════════════════════════════
if [ -n "$EMAIL" ]; then
HEAD "6. Focus: $EMAIL"
# ═════════════════════════════════════════════════════════════════════════════
# The audit's §E-verify, for one account. Query 1: when each role was granted.
echo
echo "6a. Role timeline:"
q focus-roles "
SELECT u.email, u.\"createdAt\" AS user_created, u.status, u.\"tenantId\",
       r.name::text AS role, ur.id AS user_role_id, ur.\"createdAt\" AS role_granted
FROM users u
LEFT JOIN user_roles ur ON ur.\"userId\" = u.id
LEFT JOIN roles r       ON r.id = ur.\"roleId\"
WHERE lower(u.email) = lower('$EMAIL')
ORDER BY ur.\"createdAt\";"

# Query 2: what the server actually decided for this account, and when.
echo
echo "6b. Everything the server recorded about this account, oldest first:"
q focus-audit "
SELECT a.\"createdAt\", a.action, a.resource, a.method, a.success, a.error,
       a.\"ipAddress\"
FROM audit_logs a
WHERE a.\"userId\" = (SELECT id FROM users WHERE lower(email) = lower('$EMAIL'))
ORDER BY a.\"createdAt\";"

echo
echo "6c. The activation grant this account was created from, if any:"
q focus-grant "
SELECT g.email, g.\"roleName\"::text AS granted_role, g.source::text,
       g.\"tenantId\", g.\"createdAt\", g.\"expiresAt\", g.\"redeemedAt\"
FROM tenant_activation_grants g
WHERE lower(g.email) = lower('$EMAIL')
ORDER BY g.\"createdAt\";"
fi

# ═════════════════════════════════════════════════════════════════════════════
HEAD "Summary"
# ═════════════════════════════════════════════════════════════════════════════
HAND=$(num "SELECT count(*) FROM user_roles WHERE id LIKE 'ur-%' OR \"roleId\" IN ('role-admin','role-owner','role-agent','role-buyer')")
LATE=$(num "SELECT count(*) FROM user_roles ur JOIN users u ON u.id = ur.\"userId\" WHERE ur.\"createdAt\" > u.\"createdAt\" + interval '5 minutes'")
ROLELESS=$(num "SELECT count(*) FROM users u WHERE u.status='ACTIVE' AND u.\"tenantId\" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.\"userId\"=u.id)")
AGENTADMIN=$(num "SELECT count(*) FROM (SELECT ur.\"userId\" FROM user_roles ur JOIN roles r ON r.id=ur.\"roleId\" GROUP BY ur.\"userId\" HAVING bool_or(r.name::text='AGENT') AND bool_or(r.name::text IN ('ADMIN','OWNER'))) x")
ANALYSTS=$(num "SELECT count(DISTINCT ur.\"userId\") FROM user_roles ur JOIN roles r ON r.id=ur.\"roleId\" WHERE r.name::text='ANALYST'")
MISSINGROLES=$(num "SELECT count(*) FROM unnest(ARRAY['OWNER','ADMIN','AGENT','ANALYST','PUBLISHER','BUYER','READONLY']) e WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.name::text = e)")
DUPES=$(num "SELECT count(*) FROM (SELECT ur.\"userId\", ur.\"roleId\" FROM user_roles ur GROUP BY 1,2 HAVING count(*) > 1) x")

FINDINGS=$((HAND + LATE + ROLELESS + AGENTADMIN + ANALYSTS + MISSINGROLES + DUPES))

printf '  %-52s %s\n' "role rows not written by this application:"     "$HAND"
printf '  %-52s %s\n' "roles granted >5min after the account existed:" "$LATE"
printf '  %-52s %s\n' "ACTIVE accounts with no role:"                  "$ROLELESS"
printf '  %-52s %s\n' "accounts holding AGENT and ADMIN/OWNER:"        "$AGENTADMIN"
printf '  %-52s %s\n' "duplicate role rows:"                           "$DUPES"
printf '  %-52s %s\n' "ANALYST accounts awaiting a decision:"          "$ANALYSTS"
printf '  %-52s %s\n' "expected roles missing from the roles table:"   "$MISSINGROLES"

# Reported, never counted as damage: a platform admin is a deliberate grant, and
# an all-loopback audit log is a configuration finding rather than a role one.
printf '  %-52s %s  (verify each is a known operator)\n' "PlatformAdmin rows:" \
  "$(num 'SELECT count(*) FROM platform_admins')"
printf '  %-52s %s  (1 means trustProxy is off)\n' "distinct client IPs in audit_logs:" \
  "$(num "SELECT count(DISTINCT \"ipAddress\") FROM audit_logs")"

echo
if [ "$FINDINGS" -gt 0 ]; then
  YEL "$FINDINGS finding(s) to repair. Build the account-by-account mapping from"
  YEL "sections 1 and 4 before writing anything. Never repair in bulk."
  exit 1
fi
GRN "Nothing to repair."
exit 0
