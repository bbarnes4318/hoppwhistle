#!/usr/bin/env bash
# Every migration must be in the deploy script, or named as debt.
#
# ── The trap this closes ─────────────────────────────────────────────────────
#
# This database has no `_prisma_migrations` table and has never been managed by
# `prisma migrate` (docs/MIGRATION_DIVERGENCE.md). Migrations reach production
# only by being named in `REQUIRED_MIGRATIONS` in scripts/deploy-netenroll.sh,
# which pipes each one through psql.
#
# That list is maintained by hand. Adding a migration to the repository and
# forgetting the list is silent: CI stays green, review passes, the deploy
# succeeds, and the column simply never arrives. The code that reads it ships
# anyway and talks to a schema that is not there.
#
# It is not hypothetical. At the time this check was written, SEVEN migrations
# were in the repository and not in the list, including one that had already
# merged alongside the API code that reads its column.
#
# ── What it checks ───────────────────────────────────────────────────────────
#
#   1. Every migration directory at or after BASELINE is in REQUIRED_MIGRATIONS,
#      unless it is named in KNOWN_UNLISTED below.
#   2. Every name in KNOWN_UNLISTED is still genuinely unlisted. The debt list
#      may only shrink; a name that has since been added must be removed from it
#      rather than sitting there forever meaning nothing.
#   3. Every listed migration exists on disk.
#   4. Every listed migration has an applied-state probe. The deploy already
#      refuses without one -- this finds it in CI instead of half way through a
#      production deploy, after earlier migrations have already been applied.
#
# ── BASELINE ─────────────────────────────────────────────────────────────────
#
# Migrations older than the list's first entry predate this deploy script and
# were applied by other means. They are out of scope; this check is about not
# making the problem worse from here.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy-netenroll.sh"
MIGRATIONS="$ROOT/apps/api/prisma/migrations"

RED() { printf "\033[31m%s\033[0m\n" "$*" >&2; }
GRN() { printf "\033[32m%s\033[0m\n" "$*"; }

# ─────────────────────────────────────────────────────────────────────────────
# Migrations that are in the repository, not in the deploy list, and are NOT
# being fixed by this check. Tracked debt, not hidden debt.
#
# Each one needs the same two things every listed migration has: a place in
# REQUIRED_MIGRATIONS in the right order, and an applied-state probe testing its
# LAST effect. Writing a probe means reading the migration and deciding what
# proves it ran to completion -- guessing produces a probe that reports a
# half-applied file as done, which is worse than no probe at all.
#
# Whether these ever reached production is not answerable from this repository.
# Somebody with database access has to check each one before it is added: a
# migration added to the list and NOT yet applied will be applied by the next
# deploy, and the three oldest entries in the list are documented as not
# idempotent.
#
# REMOVE NAMES FROM HERE. Never add one.
# ─────────────────────────────────────────────────────────────────────────────
KNOWN_UNLISTED="
20260915153900_grant_khall_owner_admin
20260920000000_agent_sip_credentials
20260921000000_application_call_attribution
20260921010000_agent_schedules
20260921020000_agent_availability
20260921030000_add_twilio_vonage_carriers
20260922000000_leaderboard_outbound_index
"

[ -f "$SCRIPT" ] || { RED "REFUSED: $SCRIPT not found"; exit 1; }
[ -d "$MIGRATIONS" ] || { RED "REFUSED: $MIGRATIONS not found"; exit 1; }

# The list, as the deploy script actually defines it -- read from the file
# rather than duplicated here, so the two cannot drift.
LISTED="$(sed -n '/^REQUIRED_MIGRATIONS="$/,/^"$/p' "$SCRIPT" | sed '1d;$d' | tr -d '\r')"
[ -n "$LISTED" ] || {
  RED "REFUSED: could not read REQUIRED_MIGRATIONS from $SCRIPT."
  RED "Its shape changed; this check parses it and must be updated with it."
  exit 1
}

BASELINE="$(echo "$LISTED" | awk 'NF{print $1; exit}')"
in_list()   { echo "$LISTED"         | grep -qx -- "$1"; }
is_known()  { echo "$KNOWN_UNLISTED" | grep -qx -- "$1"; }

FAILED=0

# ── 1. Nothing new may go unlisted ───────────────────────────────────────────
UNLISTED=""
for path in "$MIGRATIONS"/*/; do
  name="$(basename "$path")"
  [ "$name" = "manual" ] && continue
  [ -f "$path/migration.sql" ] || continue
  # String comparison is correct here: the names are YYYYMMDDHHMMSS-prefixed.
  [[ "$name" < "$BASELINE" ]] && continue
  in_list "$name" && continue
  is_known "$name" && continue
  UNLISTED="$UNLISTED $name"
done

if [ -n "$UNLISTED" ]; then
  RED "REFUSED: migrations exist that the deploy will never apply:"
  for m in $UNLISTED; do RED "    $m"; done
  RED ""
  RED "Add each to REQUIRED_MIGRATIONS in scripts/deploy-netenroll.sh, in the"
  RED "order it must be applied, AND give it a probe in migration_applied()."
  RED "Without both, the code that reads its schema ships to a database that"
  RED "never received it."
  FAILED=1
fi

# ── 2. The debt list may only shrink ─────────────────────────────────────────
for name in $KNOWN_UNLISTED; do
  if in_list "$name"; then
    RED "REFUSED: $name is in REQUIRED_MIGRATIONS but still named in"
    RED "KNOWN_UNLISTED in this script. Remove it from KNOWN_UNLISTED --"
    RED "a debt entry that is no longer debt hides the next real one."
    FAILED=1
  elif [ ! -d "$MIGRATIONS/$name" ]; then
    RED "REFUSED: $name is named in KNOWN_UNLISTED but no longer exists."
    RED "Remove it from KNOWN_UNLISTED."
    FAILED=1
  fi
done

# ── 3. Everything listed exists ──────────────────────────────────────────────
for name in $LISTED; do
  [ -f "$MIGRATIONS/$name/migration.sql" ] || {
    RED "REFUSED: REQUIRED_MIGRATIONS names $name, which is not in this checkout."
    FAILED=1
  }
done

# ── 4. Everything listed has a probe ─────────────────────────────────────────
#
# The deploy refuses without one. Finding it here costs a CI run; finding it
# there costs a production deploy stopped part way, with earlier migrations
# already applied.
PROBE_FN="$(sed -n '/^migration_applied() {$/,/^}$/p' "$SCRIPT")"
[ -n "$PROBE_FN" ] || {
  RED "REFUSED: could not read migration_applied() from $SCRIPT."
  exit 1
}

for name in $LISTED; do
  probe="$(bash -c "$PROBE_FN
migration_applied '$name'" 2>/dev/null || true)"
  if [ -z "${probe//[[:space:]]/}" ]; then
    RED "REFUSED: $name is in REQUIRED_MIGRATIONS with no applied-state probe."
    RED "Add a case for it in migration_applied(), testing its LAST effect."
    FAILED=1
  fi
done

if [ "$FAILED" != "0" ]; then
  exit 1
fi

LISTED_N="$(echo "$LISTED" | grep -c .)"
KNOWN_N="$(echo "$KNOWN_UNLISTED" | grep -c . || true)"
GRN "migration list ok: $LISTED_N listed and probed, $KNOWN_N tracked as unlisted debt"
