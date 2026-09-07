#!/usr/bin/env bash
# Ordered deploy for the tenant-isolation / platform-admin / audit-trail change.
#
# Usage: scripts/deploy-netenroll.sh [--dry-run] [--skip-admins]
#
# ── Why this exists rather than just running scripts/deploy.sh ────────────────
#
# scripts/deploy.sh is the sanctioned deploy and it is not being replaced: this
# script calls it, last. What it does not do is run migrations, and this change
# cannot be deployed without them in a specific order. Two things bite
# otherwise, both of them badly:
#
#   1. Every authenticated request now calls loadPlatformContext(), which reads
#      the platform_admins table. Ship the code before the migration and the API
#      fails on its first request.
#
#   2. bot.ts, quotas.ts, the /admin/api/v1/* console and the demo routes are
#      now gated on holding a PlatformAdmin row. Nobody in production holds one
#      yet. Ship without provisioning and the dialer control panel is
#      unreachable -- for everyone, including whoever is running this script.
#
# So the order is: migrate, provision, verify, then deploy. Provisioning happens
# BEFORE the new code ships, against the old running application, so there is
# never a window where the admin surface is locked.
#
# Step 3 refuses to continue if provisioning would leave zero platform admins.
# That is the guard for (2), and it is the reason to use this instead of running
# the steps by hand and trusting yourself to remember.
#
# ── What it does not do ──────────────────────────────────────────────────────
#
# It does not merge anything, and it deploys whatever is currently checked out.
# Check out the branch you mean first. It does not create user accounts -- see
# step 3.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED()  { printf "\033[31m%s\033[0m\n" "$*" >&2; }
GRN()  { printf "\033[32m%s\033[0m\n" "$*"; }
YEL()  { printf "\033[33m%s\033[0m\n" "$*"; }
STEP() { printf "\n\033[1m── %s\033[0m\n" "$*"; }

DRY_RUN=0
SKIP_ADMINS=0
for a in "$@"; do
  case "$a" in
    --dry-run)     DRY_RUN=1 ;;
    --skip-admins) SKIP_ADMINS=1 ;;
    *) RED "unknown argument: $a"; exit 64 ;;
  esac
done

run() {
  if [ "$DRY_RUN" = "1" ]; then printf "  would run: %s\n" "$*"; else "$@"; fi
}

API="pnpm --filter @hopwhistle/api"

# ═══════════════════════════════════════════════════════════════════════════
STEP "1/5  Preflight"
# ═══════════════════════════════════════════════════════════════════════════

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHA="$(git rev-parse --short HEAD)"
echo "  branch:   $BRANCH"
echo "  commit:   $SHA"

if [ -n "$(git status --porcelain)" ]; then
  RED "REFUSED: working tree is dirty. Deploy a known commit, not a surprise."
  git status --short >&2
  exit 1
fi

[ -s "$ROOT/.env" ] || { RED "REFUSED: $ROOT/.env is missing or empty (needed by scripts/deploy.sh)."; exit 1; }
[ -s "$ROOT/apps/api/.env" ] || { RED "REFUSED: apps/api/.env is missing; Prisma reads DATABASE_URL from it."; exit 1; }

# The migrations this deploy needs, by directory name. Named explicitly so the
# script fails loudly on a checkout that does not contain them rather than
# deploying code whose schema is absent.
REQUIRED_MIGRATIONS="
20260906000000_add_tenant_activation_grants
20260907000000_add_platform_admin
20260907010000_audit_log_nullable_tenant
"
for m in $REQUIRED_MIGRATIONS; do
  [ -f "$ROOT/apps/api/prisma/migrations/$m/migration.sql" ] || {
    RED "REFUSED: migration $m is not in this checkout. Wrong branch?"; exit 1; }
done
GRN "preflight ok: clean tree, env files present, 3 required migrations found"

# ═══════════════════════════════════════════════════════════════════════════
STEP "2/5  Database migrations"
# ═══════════════════════════════════════════════════════════════════════════
echo "  prisma migrate deploy — all three are additive; none drops or rewrites data."
run $API db:migrate:deploy
run $API db:constraints
GRN "migrations applied"

# ═══════════════════════════════════════════════════════════════════════════
STEP "3/5  Platform administrators"
# ═══════════════════════════════════════════════════════════════════════════
#
# Deliberately before the deploy: the tables exist now, the old code is still
# running, and granting the capability early means there is no window in which
# the admin surface is gated on a row nobody has.
#
# This does NOT create logins. An account is created through the activation-grant
# invitation path; a provisioning script that mints accounts would be a second
# way in. If an address here has no account yet, invite them and re-run.

if [ "$SKIP_ADMINS" = "1" ]; then
  YEL "  --skip-admins: skipping provisioning AND the lockout check."
  YEL "  Only correct if platform admins already exist. Verify with:"
  YEL "    $API platform:admins"
else
  if [ -z "${PLATFORM_ADMIN_EMAILS:-}" ]; then
    YEL "  PLATFORM_ADMIN_EMAILS is unset, so only joel.vasquez@outlook.com is in"
    YEL "  the launch set. Set it to your own address and re-run to include it."
  fi
  run $API platform:admins -- --sync

  # The guard. Deploying with zero platform admins locks the dialer console,
  # the quota routes and the /admin/api/v1 console for everybody.
  #
  # The listing's exit status is checked separately from its content: an
  # unreachable database also prints no admins, and reporting that as "you have
  # no platform admins" would send someone off provisioning accounts when the
  # real problem is that nothing can read the table. Both refuse the deploy --
  # they just say different true things about why.
  if [ "$DRY_RUN" = "0" ]; then
    if ! ADMIN_LIST="$($API platform:admins 2>&1)"; then
      RED "REFUSED: could not read the platform admin list."
      RED "$ADMIN_LIST"
      exit 2
    fi

    # `[[:space:]]` rather than `\s`: POSIX ERE has no \s, and BSD grep does not
    # accept it. Counts the address lines; the indented `note:` lines carry no
    # `@` and so do not inflate the total.
    ADMIN_COUNT="$(printf '%s\n' "$ADMIN_LIST" \
      | grep -cE '^[[:space:]]+[^[:space:]]+@[^[:space:]]+' || true)"

    if [ "${ADMIN_COUNT:-0}" -lt 1 ]; then
      RED "REFUSED: no platform admins exist."
      RED "Deploying now would make the dialer console, the quota routes and the"
      RED "/admin/api/v1 console unreachable for everyone, including you."
      RED ""
      RED "Fix: make sure the accounts exist (invite them), then re-run. Or pass"
      RED "--skip-admins if you have verified they exist by another route."
      exit 2
    fi
    GRN "platform admins present: $ADMIN_COUNT"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
STEP "4/5  Deploy"
# ═══════════════════════════════════════════════════════════════════════════
#
# Hands off to the sanctioned deploy, which carries its own guards: the compose
# file check, the required-secret preflight, the in-container secret postflight
# and the postgres volume-identity check.
run "$ROOT/scripts/deploy.sh" --build api web

# ═══════════════════════════════════════════════════════════════════════════
STEP "5/5  Postflight"
# ═══════════════════════════════════════════════════════════════════════════
if [ "$DRY_RUN" = "1" ]; then
  GRN "dry run complete — nothing was changed"
  exit 0
fi

sleep 3
if curl -fsS --max-time 10 http://localhost:3001/health >/dev/null 2>&1; then
  GRN "postflight ok: API answering /health"
else
  RED "POSTFLIGHT FAILED: API is not answering /health."
  RED "Check: docker logs --tail 100 hopwhistle-api-dev"
  exit 3
fi

GRN "deploy complete"
cat <<'NOTE'

Two behaviour changes that are live from this moment:

  Self-serve signup now requires an invitation. POST /api/auth/register
  refuses without an activation token, which is the fix for strangers landing
  inside a paying agency. Issue invitations with:
      POST /api/v1/auth/activation-grants   { "email": "...", "role": "AGENT" }
  as an OWNER or ADMIN of the agency they are joining.

  auditLog() now raises instead of swallowing. If the audit table becomes
  unwritable, operations that audit will fail rather than proceed unrecorded.
  Watch for 'authorization.denied' / 'auth.login.*' write errors in the API log.

NOTE
