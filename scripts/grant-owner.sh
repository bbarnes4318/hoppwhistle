#!/usr/bin/env bash
#
# Give an account the OWNER and ADMIN roles. Run this ON THE SERVER.
#
#   ./scripts/grant-owner.sh you@example.com
#
# ── What this is for ────────────────────────────────────────────────────────
#
# Where a person lands after signing in is decided by the roles on their
# account, and an account holding AGENT and nothing else is sent to
# /call-center -- that is correct for an agent and wrong for the person who
# owns the agency. An owner whose account was given an AGENT role for testing,
# and never given OWNER, signs in to the call centre and sees nothing else: the
# sidebar, the admin pages and the tenant-wide dashboard are all gated on
# OWNER/ADMIN.
#
# This puts the two roles back. It adds; it removes nothing, so an owner who
# also takes calls keeps AGENT and keeps their extension.
#
# It is idempotent -- running it twice changes nothing the second time -- and it
# prints the account's roles before and after so you can see what it did.
set -euo pipefail

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "usage: $0 <email>" >&2
  exit 64
fi

cd "$(dirname "$0")/.."

# The compose project the deploy uses, so this reaches the same database the
# API is talking to rather than a stray container.
COMPOSE="docker compose --env-file .env -f infra/docker/docker-compose.dev.yml"

# The same .env compose reads, so an installation that overrode the database
# user or name is reached rather than the defaults. Only these two are taken
# from it, and only when the surrounding shell has not already set them.
if [ -f .env ]; then
  for var in POSTGRES_USER POSTGRES_DB; do
    eval "current=\${$var:-}"
    if [ -z "$current" ]; then
      value="$(grep -E "^${var}=" .env | tail -n 1 | cut -d= -f2- || true)"
      [ -n "$value" ] && eval "$var=\$value"
    fi
  done
fi

PGUSER_NAME="${POSTGRES_USER:-callfabric}"
PGDB_NAME="${POSTGRES_DB:-callfabric}"

psql_run() {
  $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PGUSER_NAME" -d "$PGDB_NAME" "$@"
}

show_roles() {
  psql_run -c "SELECT u.email, COALESCE(string_agg(r.name::text, ', ' ORDER BY r.name::text), '(none)') AS roles
               FROM users u
               LEFT JOIN user_roles ur ON ur.\"userId\" = u.id
               LEFT JOIN roles r ON r.id = ur.\"roleId\"
               WHERE lower(u.email) = lower('$EMAIL')
               GROUP BY u.email;"
}

echo "Before:"
show_roles

# One statement, so a failure leaves nothing half-applied. ON CONFLICT DO
# NOTHING is the idempotence: `user_roles` is unique on (userId, roleId).
psql_run <<SQL
INSERT INTO user_roles (id, "userId", "roleId", "createdAt")
SELECT gen_random_uuid(), u.id, r.id, now()
FROM users u
CROSS JOIN roles r
WHERE lower(u.email) = lower('$EMAIL')
  AND r.name IN ('OWNER', 'ADMIN')
ON CONFLICT ("userId", "roleId") DO NOTHING;
SQL

echo "After:"
show_roles

cat <<'NOTE'

Done. Sign out and sign back in -- the roles are read once, when the session
starts, so a tab that is already open keeps the old ones until it does.
NOTE
