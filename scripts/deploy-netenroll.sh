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
# Migrations are applied by piping migration.sql into psql, which is how every
# migration on this database has ever been applied. It deliberately does NOT run
# `prisma migrate deploy`: there is no _prisma_migrations table on production,
# so that command would find an empty history and try to replay the whole
# repository against a schema where those objects already exist. Step 2 says
# more; docs/MIGRATION_DIVERGENCE.md has the measurements.
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

# The migrations this deploy needs, IN THE ORDER THEY MUST BE APPLIED. Named
# explicitly so the script fails loudly on a checkout that does not contain them
# rather than deploying code whose schema is absent, and so the order is a
# reviewable list rather than whatever `ls` returns.
REQUIRED_MIGRATIONS="
20260906000000_add_tenant_activation_grants
20260907000000_add_platform_admin
20260907010000_audit_log_nullable_tenant
20260908000000_add_rating_engine
20260914000000_agent_entered_applications
20260915000000_role_preview
"
MIGRATION_COUNT=0
for m in $REQUIRED_MIGRATIONS; do
  [ -f "$ROOT/apps/api/prisma/migrations/$m/migration.sql" ] || {
    RED "REFUSED: migration $m is not in this checkout. Wrong branch?"; exit 1; }
  MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
done

# psql is how every migration on this database has ever been applied, and step 2
# now uses it directly. Checking here rather than discovering it mid-deploy.
command -v psql >/dev/null 2>&1 || {
  RED "REFUSED: psql is not on PATH. Step 2 applies migrations through psql;"
  RED "there is no Prisma CLI fallback, deliberately \u2014 see step 2."
  exit 1; }

# Step 3's provisioning is a Node CLI, so it needs node_modules on the host --
# which a host running the API from an image does not have. Checked HERE rather
# than at step 3, because step 3 is after the migrations: discovering it there
# stops the deploy half done, with the database moved and nothing shipped. That
# is exactly how one run ended, at `sh: 1: prisma: not found`.
if [ "$SKIP_ADMINS" = "0" ] && [ ! -d "$ROOT/apps/api/node_modules" ]; then
  RED "REFUSED: apps/api/node_modules is missing, so step 3 could not run."
  RED "Caught now, before the database is touched."
  RED ""
  RED "This host runs the API from an image and has no dependencies installed."
  RED "Two ways forward:"
  RED ""
  RED "  1. If platform admins already exist, re-run with --skip-admins."
  RED "     Check first, and require a count of 1 or more:"
  RED ""
  RED "       set -a; . apps/api/.env; set +a"
  RED "       psql \"\$DATABASE_URL\" -tAc 'select count(*) from platform_admins'"
  RED ""
  RED "  2. To provision from this host, install dependencies: pnpm install"
  exit 1
fi

# DATABASE_URL comes from apps/api/.env, which Prisma also reads. Sourced rather
# than parsed so a quoted value or an inline comment behaves the same way it
# does for every other consumer of that file.
set -a
# shellcheck disable=SC1091
. "$ROOT/apps/api/.env"
set +a

[ -n "${DATABASE_URL:-}" ] || {
  RED "REFUSED: DATABASE_URL is not set in apps/api/.env."; exit 1; }

# ── The assumption this whole script rests on ────────────────────────────────
#
# This database has never been managed by `prisma migrate`. There is no
# _prisma_migrations table; every migration to date was applied by piping its
# migration.sql into psql by hand, and step 2 below does exactly that.
#
# If that table ever appears, the deployment model changed underneath this
# script and the assumption no longer holds: some other process is now tracking
# migration state, and applying the same SQL again outside it would leave the
# two disagreeing about what has run. Refuse rather than guess.
if [ "$DRY_RUN" = "0" ]; then
  if ! HAS_PRISMA_TABLE="$(psql "$DATABASE_URL" -tAc \
      "SELECT to_regclass('public._prisma_migrations') IS NOT NULL" 2>&1)"; then
    RED "REFUSED: could not reach the database to check the migration model."
    RED "$HAS_PRISMA_TABLE"
    exit 1
  fi

  if [ "$HAS_PRISMA_TABLE" = "t" ]; then
    RED "REFUSED: _prisma_migrations exists on this database."
    RED ""
    RED "This script applies migration SQL through psql because this database"
    RED "has never been managed by prisma migrate. That table means something"
    RED "else is now tracking migration state, and applying the same SQL"
    RED "outside it would leave the two disagreeing about what has run."
    RED ""
    RED "Decide which model this database is on, and update this script to"
    RED "match, before deploying."
    exit 1
  fi
  GRN "migration model ok: no _prisma_migrations table, as expected"
fi

GRN "preflight ok: clean tree, env files present, $MIGRATION_COUNT required migrations found"

# ═══════════════════════════════════════════════════════════════════════════
STEP "2/5  Database migrations"
# ═══════════════════════════════════════════════════════════════════════════
#
# ── Why this does not call the Prisma CLI ────────────────────────────────────
#
# It used to run `prisma migrate deploy`, and that would have failed, badly, the
# first time anyone ran this script for real.
#
# The production database has NO _prisma_migrations table. It has never been
# managed by prisma migrate. Every migration to date was applied by piping
# migration.sql into psql by hand. `migrate deploy` against that database finds
# an empty history and concludes that NOTHING has been applied, so it tries to
# replay every migration in the repository from the beginning -- CREATE TABLE
# against tables that already exist, against a schema that has also drifted from
# schema.prisma. docs/MIGRATION_DIVERGENCE.md measured it: a replay from scratch
# dies at migration 12 of 14 regardless, because the history references tables
# no migration creates.
#
# .github/workflows/dialer-v2.yml already says this in its own comments, and
# both CI workflows use `db push` for the same reason. This script was the one
# place still reaching for the CLI.
#
# So: apply the named files, in the order the preflight listed them, through
# psql. That is what has actually been happening all along; the only change is
# that it is now written down and checked instead of done by hand.
#
# ── Re-runnability ───────────────────────────────────────────────────────────
#
# With no _prisma_migrations table there is no applied-state to consult, so this
# probes the database for each migration's own visible effect and skips the ones
# already there. That is not a nicety: a deploy that fails at step 4 has to be
# re-runnable, and the three older migrations here are NOT idempotent -- the
# activation-grants file opens with an unguarded CREATE TYPE and dies on a
# second run. (The rating-engine migration is guarded throughout and would be a
# no-op, but relying on that for some files and not others would make the
# script's behaviour depend on which file it happened to reach.)
#
# The probe is per migration, written out, and is the SAME expression used to
# verify the apply afterwards. One list, two uses: if the probe is wrong the
# verification is wrong too and the deploy stops, rather than the two quietly
# disagreeing.
#
# ON_ERROR_STOP=1 plus the single transaction inside each file mean a failure
# leaves that migration unapplied rather than half-applied, and the loop stops
# on the first one.

# Has this migration's effect landed? Echoes `t` or `f`.
migration_applied() {
  case "$1" in
    *_add_tenant_activation_grants)
      echo "SELECT to_regclass('public.tenant_activation_grants') IS NOT NULL" ;;
    *_add_platform_admin)
      echo "SELECT to_regclass('public.platform_admins') IS NOT NULL" ;;
    *_audit_log_nullable_tenant)
      # Not a new table: this one relaxes a column, so table presence proves
      # nothing and the nullability is the only visible effect.
      echo "SELECT COALESCE((SELECT is_nullable = 'YES' FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'audit_logs'
                AND column_name = 'tenantId'), false)" ;;
    *_add_rating_engine)
      echo "SELECT to_regclass('public.rate_curve_versions') IS NOT NULL" ;;
    *_agent_entered_applications)
      # Adds columns to an existing table, so table presence proves nothing --
      # `insurance_carrier_applications` has been there since the RPA shipped.
      # `source` is the column the change turns on: it marks a row as
      # agent-entered rather than automation-written, and the closing percentage
      # reads `voidedAt` from the same file. If `source` is there, the file ran.
      echo "SELECT COALESCE((SELECT true FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'insurance_carrier_applications'
                AND column_name = 'source'), false)" ;;
    *_role_preview)
      # Adds one column to an existing table, so table presence proves nothing --
      # platform_acting_tenants has existed since the acting-tenant switch shipped.
      # previewRole is the column the change turns on, and loadPlatformContext
      # selects it on every authenticated request.
      echo "SELECT COALESCE((SELECT true FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'platform_acting_tenants'
                AND column_name = 'previewRole'), false)" ;;
    *)
      echo "" ;;
  esac
}

probe() {
  psql "$DATABASE_URL" -tAc "$1" 2>&1 | tr -d '[:space:]'
}

for m in $REQUIRED_MIGRATIONS; do
  SQL="$ROOT/apps/api/prisma/migrations/$m/migration.sql"
  CHECK="$(migration_applied "$m")"

  if [ -z "$CHECK" ]; then
    RED "REFUSED: no applied-state probe is defined for migration $m."
    RED "Add one to migration_applied() in this script. Without it the deploy"
    RED "cannot tell whether the migration has already run, and this script"
    RED "will not apply SQL it cannot verify."
    exit 1
  fi

  if [ "$DRY_RUN" = "1" ]; then
    printf "  would check and, if needed, apply: %s\n" "$m"
    continue
  fi

  BEFORE="$(probe "$CHECK")"
  if [ "$BEFORE" = "t" ]; then
    echo "  $m — already applied, skipping"
    continue
  fi
  if [ "$BEFORE" != "f" ]; then
    RED "REFUSED: could not determine whether $m has been applied."
    RED "$BEFORE"
    exit 1
  fi

  echo "  applying $m"
  if ! OUT="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$SQL" 2>&1)"; then
    RED "REFUSED: migration $m failed. Nothing after it has been applied."
    RED "$OUT"
    exit 1
  fi

  # Verify rather than trust the exit status. psql -f with ON_ERROR_STOP exits
  # non-zero on a SQL error, but a file that silently did nothing -- an empty
  # file, a truncated checkout -- exits zero and looks identical from here.
  if [ "$(probe "$CHECK")" != "t" ]; then
    RED "REFUSED: $m reported success but its effect is not present."
    RED "Probe: $CHECK"
    RED "Applied output was:"
    RED "$OUT"
    exit 1
  fi
  GRN "  applied $m"
done

# Constraints Prisma's schema language cannot express. A partial unique index is
# not representable in schema.prisma, so lead_dial_reservations'
# one-active-reservation-per-lead guarantee lives in SQL. Without it concurrent
# workers each claim the same lead and several agents dial the same person.
#
# Applied with psql, like every other piece of SQL in this step.
#
# It used to be `pnpm … db:constraints`, i.e. `prisma db execute --file`, which
# is a plain file-runner -- it reads no history and applies exactly the file it
# is given, so it was never the thing this step exists to avoid. But it needs
# the Prisma CLI, which means node_modules on the host, and the production host
# deliberately has none: the API runs from an image that carries its own. So the
# deploy died here with `sh: 1: prisma: not found` AFTER both migrations had
# been applied -- the worst place to stop, half done and with nothing said
# about it.
#
# psql has no such dependency, this script already refuses to start without it,
# and the file is idempotent by contract ("Every statement must be idempotent"),
# so re-running is safe.
CONSTRAINTS="$ROOT/apps/api/prisma/sql/db-push-constraints.sql"
[ -f "$CONSTRAINTS" ] || {
  RED "REFUSED: $CONSTRAINTS is not in this checkout."; exit 1; }

# ── Why this is conditional, and not simply applied ─────────────────────────
#
# That file's own header says where it belongs: "Run this immediately after db
# push, wherever a schema is created." It is written for a database built from
# schema.prisma in one shot -- CI, a developer's box -- which therefore has
# every table in the schema.
#
# THIS database was not built that way, and does not. Applying the file to
# production fails on its first statement:
#
#     ERROR: relation "lead_dial_reservations" does not exist
#
# because `20260803000000_add_lead_dial_reservations` is in the repository and
# is not in REQUIRED_MIGRATIONS above, so no deploy has ever applied it. The
# same is true of most of the 31 migrations in `prisma/migrations`: six are
# registered here. That gap is the real defect -- it is what produced the
# `insurance_carrier_applications.voidedAt` P2022 in production -- and it is
# not this step's to fix.
#
# So: apply the file when its tables are all present, and when they are not,
# name what is missing and carry on. A constraint cannot protect a table that
# does not exist, and refusing here would block every deploy on this host over
# a file that was never applicable to it.
CONSTRAINT_TABLES="lead_dial_reservations application_credit_ledger daily_settlements settlement_payment_attempts"
MISSING_TABLES=""
for t in $CONSTRAINT_TABLES; do
  if [ "$(probe "SELECT to_regclass('public.$t') IS NOT NULL")" != "t" ]; then
    MISSING_TABLES="$MISSING_TABLES $t"
  fi
done

if [ -n "$MISSING_TABLES" ]; then
  YEL "  skipping prisma/sql/db-push-constraints.sql - tables absent:$MISSING_TABLES"
  YEL "  Their migrations are in prisma/migrations and not in this script's"
  YEL "  REQUIRED_MIGRATIONS, so no deploy has applied them. Register them"
  YEL "  there (with an applied-state probe each) to create these tables; the"
  YEL "  constraints then apply on the next run."
elif [ "$DRY_RUN" = "1" ]; then
  printf "  would apply: %s\n" "prisma/sql/db-push-constraints.sql"
else
  if ! OUT="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$CONSTRAINTS" 2>&1)"; then
    RED "REFUSED: db-push-constraints.sql failed."
    RED "$OUT"
    exit 1
  fi

  # Verify rather than trust, the same way each migration above is verified: a
  # file that silently did nothing exits zero and looks identical from here.
  if [ "$(probe "SELECT to_regclass('public.lead_dial_reservations_active_lead_key') IS NOT NULL")" != "t" ]; then
    RED "REFUSED: the constraints file reported success but its index is absent."
    RED "$OUT"
    exit 1
  fi
  GRN "  applied prisma/sql/db-push-constraints.sql"
fi

GRN "migrations applied and verified"

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
  YEL "    psql \"\$DATABASE_URL\" -tAc 'select count(*) from platform_admins'"
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
