#!/usr/bin/env bash
#
# Everything that decides where an account lands after signing in. Run this ON
# THE SERVER.
#
#   ./scripts/check-account.sh you@example.com
#
# ── Why this is one command ─────────────────────────────────────────────────
#
# "I sign in and I am stuck on the call centre" has more than one cause, and
# the obvious one is not always it. An account can hold OWNER in the database
# and still be handed a different role by the API, because for a platform
# operator `/api/auth/me` answers with the PRINCIPAL, not the row: a role
# preview replaces the operator's own ADMIN/OWNER with exactly the previewed
# role. An operator who left a preview as AGENT switched on is an agent to
# every page in the app, while `SELECT ... FROM user_roles` still says OWNER.
#
# So this prints all three things at once -- the roles on the row, whether the
# account is a platform admin, and any preview that is currently replacing
# those roles -- because reading only the first one is what sent an earlier
# diagnosis down the wrong path.
#
# It reads and changes nothing.
set -euo pipefail

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "usage: $0 <email>" >&2
  exit 64
fi

cd "$(dirname "$0")/.."

COMPOSE="docker compose --env-file .env -f infra/docker/docker-compose.dev.yml"

# The same .env compose reads, so an installation that overrode the database
# user or name is reached rather than the defaults.
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

$COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PGUSER_NAME" -d "$PGDB_NAME" <<SQL
\\pset border 2
SELECT
  u.email,
  COALESCE(
    (SELECT string_agg(r.name::text, ', ' ORDER BY r.name::text)
     FROM user_roles ur JOIN roles r ON r.id = ur."roleId"
     WHERE ur."userId" = u.id),
    '(none)'
  )                                        AS row_roles,
  (pa."userId" IS NOT NULL)                AS is_platform_admin,
  COALESCE(pat."previewRole", '(none)')    AS preview_replacing_those_roles,
  COALESCE(t.name, '(cross-agency)')       AS acting_agency
FROM users u
LEFT JOIN platform_admins pa          ON pa."userId"  = u.id
LEFT JOIN platform_acting_tenants pat ON pat."userId" = u.id
LEFT JOIN tenants t                   ON t.id = pat."tenantId"
WHERE lower(u.email) = lower('$EMAIL');
SQL

cat <<'NOTE'

Reading it:

  row_roles                      what the database says the account is.
  is_platform_admin              t means /api/auth/me answers with the
                                 principal, so row_roles is NOT what the
                                 browser receives.
  preview_replacing_those_roles  anything but (none) IS what the browser
                                 receives -- exactly that one role, with the
                                 account's own ADMIN/OWNER replaced. AGENT here
                                 is why an owner lands on the call centre.

To clear a stuck preview:

  ./scripts/clear-preview.sh <email>

NOTE
