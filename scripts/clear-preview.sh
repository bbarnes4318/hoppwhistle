#!/usr/bin/env bash
#
# Switch off a platform operator's role preview. Run this ON THE SERVER.
#
#   ./scripts/clear-preview.sh you@example.com
#
# ── What a preview is, and how it strands somebody ──────────────────────────
#
# A platform operator can view an agency as one of its own roles. While that is
# on, the principal carries EXACTLY that role: `middleware/auth.ts` REPLACES the
# operator's ADMIN/OWNER rather than adding to it, so every page, guard and
# redirect in the app treats them as that role and nothing else.
#
# Previewing as AGENT therefore sends the operator to /call-center on sign-in,
# the same as a real agent. Their `user_roles` rows still say OWNER the whole
# time, which is what makes it hard to see: the obvious query says the account
# is fine.
#
# The switcher in the app turns a preview off, but reaching the switcher means
# reaching a page that has one -- and the call centre renders fullscreen, with
# no topbar. That is the corner this exists for.
#
# It clears the preview only. It does not leave the agency, change a role, or
# touch anything else, and clearing a preview that is already off is a no-op.
set -euo pipefail

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "usage: $0 <email>" >&2
  exit 64
fi

cd "$(dirname "$0")/.."

COMPOSE="docker compose --env-file .env -f infra/docker/docker-compose.dev.yml"

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

SELECT u.email, COALESCE(pat."previewRole", '(none)') AS preview_before
FROM users u
LEFT JOIN platform_acting_tenants pat ON pat."userId" = u.id
WHERE lower(u.email) = lower('$EMAIL');

UPDATE platform_acting_tenants
SET "previewRole" = NULL
WHERE "userId" = (SELECT id FROM users WHERE lower(email) = lower('$EMAIL'));

SELECT u.email, COALESCE(pat."previewRole", '(none)') AS preview_after
FROM users u
LEFT JOIN platform_acting_tenants pat ON pat."userId" = u.id
WHERE lower(u.email) = lower('$EMAIL');
SQL

cat <<'NOTE'

Done. Sign out and sign back in -- the principal is resolved when the session
starts, so a tab that is already open keeps the preview until it does.

UPDATE 0 means there was no acting-agency row at all, so there was no preview
to clear and the lockout is something else. Run ./scripts/check-account.sh for
the full picture.
NOTE
