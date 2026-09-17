#!/usr/bin/env bash
#
# What does schema.prisma expect that this database does not have?
#
# ── Why this exists ──────────────────────────────────────────────────────────
#
# This database is not built by `prisma migrate`. There is no _prisma_migrations
# table; every migration is applied by piping its migration.sql into psql, and
# which files get piped is a HAND-MAINTAINED LIST in scripts/deploy-netenroll.sh:
#
#     REQUIRED_MIGRATIONS="
#     20260906000000_add_tenant_activation_grants
#     ...
#
# A migration that is in prisma/migrations and not in that list is never applied
# to anything. Nothing warns. The deploy runs to completion, reports success,
# and starts an API whose queries name columns that do not exist. That has now
# happened at least three times:
#
#   insurance_carrier_applications.voidedAt   500 on /api/v1/live/strip
#   lead_dial_reservations                    table absent entirely
#   the five billing migrations               found by a second reader, by eye
#
# Each was found when something broke. This finds all of them at once, before
# anything breaks, by comparing the schema the code is generated from against
# the database the code will talk to.
#
# ── What it reports ──────────────────────────────────────────────────────────
#
#   tables      in schema.prisma, absent from the database
#   columns     likewise, per table
#   enum types  likewise
#   enum values a type that exists but is missing a variant -- which is how
#               `source` (AUTOMATION | AGENT_ENTRY) would fail: the column and
#               the type both exist and the insert still errors
#
# For each missing table and column it also names the migration file that
# creates it, and says whether that file is registered with the deploy. That is
# the actual fix, so the output should not need a second investigation.
#
# ── What it does to your data: nothing ───────────────────────────────────────
#
# Every statement is a SELECT. It creates no table, not even a temporary one:
# the expected names travel into the query as VALUES lists. It is safe to run
# against production, which is the only place worth running it.
#
#   ./scripts/schema-drift.sh
#   ./scripts/schema-drift.sh --url "postgresql://user:pass@host:5432/db"
#   ./scripts/schema-drift.sh --extras     # also: in the database, not in the schema
#
# With no --url it reads DATABASE_URL from apps/api/.env, the same file Prisma
# and the deploy read.
#
# Exit status: 0 in sync, 1 drift found, 2 could not tell.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/apps/api/prisma/schema.prisma"
MIGRATIONS="$ROOT/apps/api/prisma/migrations"
DEPLOY="$ROOT/scripts/deploy-netenroll.sh"

URL=""
EXTRAS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --url=*) URL="${1#--url=}"; shift ;;
    --extras) EXTRAS=1; shift ;;
    -h|--help) sed -n '2,60p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

RED() { printf '\033[31m%s\033[0m\n' "$*"; }
GRN() { printf '\033[32m%s\033[0m\n' "$*"; }
YEL() { printf '\033[33m%s\033[0m\n' "$*"; }
DIM() { printf '\033[2m%s\033[0m\n' "$*"; }

command -v psql >/dev/null 2>&1 || {
  RED "psql is not on PATH."
  echo "  Ubuntu/Debian: sudo apt-get install -y postgresql-client" >&2
  exit 2; }

[ -f "$SCHEMA" ] || { RED "No schema at $SCHEMA"; exit 2; }

if [ -z "$URL" ]; then
  if [ -f "$ROOT/apps/api/.env" ]; then
    # Sourced rather than parsed, so a quoted value or an inline comment
    # behaves the way it does for every other reader of this file.
    set -a
    # shellcheck disable=SC1091
    . "$ROOT/apps/api/.env"
    set +a
    URL="${DATABASE_URL:-}"
  fi
fi

[ -n "$URL" ] || {
  RED "No database URL. Pass --url, or set DATABASE_URL in apps/api/.env."; exit 2; }

# ── 1. What the schema expects ───────────────────────────────────────────────
#
# Parsed rather than asked of Prisma on purpose: the Prisma CLI needs
# node_modules, and the host that runs the production database does not have
# them -- the API runs from an image carrying its own. A deploy already died on
# exactly that. awk and psql are present everywhere.
WANT="$(mktemp)"
DBHAVE_T="$(mktemp)"
trap 'rm -f "$WANT" "$DBHAVE_T"' EXIT

awk '
  # ── pass 1: which names are models and enums ──────────────────────────────
  # A field whose type is a MODEL is a relation and occupies no column, so the
  # model names have to be known before any field can be classified. Hence two
  # passes over the same file.
  NR == FNR {
    if ($0 ~ /^[ \t]*model[ \t]+[A-Za-z_]/) {
      n = $0; sub(/^[ \t]*model[ \t]+/, "", n); sub(/[ \t{].*$/, "", n); MODEL[n] = 1
    } else if ($0 ~ /^[ \t]*enum[ \t]+[A-Za-z_]/) {
      n = $0; sub(/^[ \t]*enum[ \t]+/, "", n); sub(/[ \t{].*$/, "", n); ENUMN[n] = 1
    }
    next
  }

  function mapped(s,   m) {
    # `@map("x")` on a field or an enum value. Block attributes are handled
    # before this is reached, so a bare @map here cannot be an @@map. Note
    # `@relation(..., map: "y")` names a constraint and has no `@` in front of
    # `map`, so it cannot match.
    if (match(s, /@map\("[^"]*"\)/)) {
      m = substr(s, RSTART, RLENGTH)
      sub(/^@map\("/, "", m); sub(/"\)$/, "", m)
      return m
    }
    return ""
  }

  function blockmap(s,   m) {
    if (match(s, /@@map\("[^"]*"\)/)) {
      m = substr(s, RSTART, RLENGTH)
      sub(/^@@map\("/, "", m); sub(/"\)$/, "", m)
      return m
    }
    return ""
  }

  function flush() {
    if (block == "model") {
      print "T\t" tname
      for (i = 1; i <= nf; i++) print "C\t" tname "\t" FN[i]
    } else if (block == "enum") {
      print "E\t" edb
      for (i = 1; i <= nv; i++) print "V\t" edb "\t" EV[i]
    }
  }

  # ── pass 2 ────────────────────────────────────────────────────────────────
  {
    line = $0
    gsub(/\r/, "", line)

    if (block == "") {
      if (line ~ /^[ \t]*model[ \t]+[A-Za-z_]/) {
        block = "model"; nf = 0
        tname = line; sub(/^[ \t]*model[ \t]+/, "", tname); sub(/[ \t{].*$/, "", tname)
        next
      }
      if (line ~ /^[ \t]*enum[ \t]+[A-Za-z_]/) {
        block = "enum"; nv = 0
        edb = line; sub(/^[ \t]*enum[ \t]+/, "", edb); sub(/[ \t{].*$/, "", edb)
        next
      }
      # `type` is a composite (Mongo only), `view` is not a table, and
      # datasource/generator hold no fields. Consumed so their contents are
      # never read as fields.
      if (line ~ /^[ \t]*(type|view|datasource|generator)[ \t]+[A-Za-z_]/) { block = "skip"; next }
      next
    }

    if (line ~ /^[ \t]*}[ \t]*$/) { flush(); block = ""; next }
    if (block == "skip") next

    s = line; sub(/^[ \t]+/, "", s)
    if (s == "" || s ~ /^\/\//) next

    if (s ~ /^@@/) {
      m = blockmap(s)
      if (m != "") { if (block == "model") tname = m; else edb = m }
      next
    }

    split(s, tok, /[ \t]+/)

    if (block == "enum") {
      if (tok[1] !~ /^[A-Za-z_][A-Za-z0-9_]*$/) next
      m = mapped(s)
      nv++; EV[nv] = (m != "" ? m : tok[1])
      next
    }

    # A model field needs a name AND a type; anything shorter is not one.
    if (tok[2] == "") next

    bt = tok[2]; gsub(/\?|\[\]/, "", bt)
    if (bt in MODEL) next   # a relation: no column of its own

    m = mapped(s)
    nf++; FN[nf] = (m != "" ? m : tok[1])
  }
' "$SCHEMA" "$SCHEMA" > "$WANT"

WANT_T=$(grep -c '^T	' "$WANT" || true)
WANT_C=$(grep -c '^C	' "$WANT" || true)
WANT_E=$(grep -c '^E	' "$WANT" || true)
WANT_V=$(grep -c '^V	' "$WANT" || true)

if [ "${WANT_T:-0}" -lt 1 ]; then
  RED "Parsed no models out of $SCHEMA. Refusing to report everything as missing."
  exit 2
fi

# ── 2. Ask the database ──────────────────────────────────────────────────────
#
# Each category is one query against a VALUES list of what the schema expects.
# No temporary tables, no writes -- see the header.

sqlq() { printf "%s" "$1" | sed "s/'/''/g"; }

values_1() { # kind -> ('a'),('b')
  awk -F'\t' -v k="$1" '$1 == k { gsub(/'"'"'/, "'"'"''"'"'", $2); printf "%s('"'"'%s'"'"')", sep, $2; sep="," }' "$WANT"
}
values_2() { # kind -> ('a','x'),('b','y')
  awk -F'\t' -v k="$1" '$1 == k {
    gsub(/'"'"'/, "'"'"''"'"'", $2); gsub(/'"'"'/, "'"'"''"'"'", $3)
    printf "%s('"'"'%s'"'"','"'"'%s'"'"')", sep, $2, $3; sep=","
  }' "$WANT"
}

run() { psql "$URL" -tA -F'|' --no-psqlrc -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

IDENTITY="$(run "SELECT current_database() || '|' || COALESCE(inet_server_addr()::text, 'local socket') || '|' || pg_size_pretty(pg_database_size(current_database()))")"
if [ "$?" -ne 0 ] || printf '%s' "$IDENTITY" | grep -qi '^psql:\|error'; then
  RED "Could not reach the database."
  echo "$IDENTITY" | sed 's/^/  /'
  exit 2
fi

DB_NAME="$(printf '%s' "$IDENTITY" | cut -d'|' -f1)"
DB_HOST="$(printf '%s' "$IDENTITY" | cut -d'|' -f2)"
DB_SIZE="$(printf '%s' "$IDENTITY" | cut -d'|' -f3)"

MISSING_T="$(run "
  WITH want(t) AS (VALUES $(values_1 T))
  SELECT w.t FROM want w
   WHERE to_regclass('public.' || quote_ident(w.t)) IS NULL
   ORDER BY w.t")"

# Columns are only asked about for tables that exist: a missing table would
# otherwise report every one of its columns as well, burying the finding under
# its own consequences.
MISSING_C="$(run "
  WITH want(t, c) AS (VALUES $(values_2 C))
  SELECT w.t || '|' || w.c
    FROM want w
   WHERE to_regclass('public.' || quote_ident(w.t)) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = 'public'
          AND ic.table_name = w.t
          AND ic.column_name = w.c)
   ORDER BY w.t, w.c")"

MISSING_E=""
MISSING_V=""
if [ "${WANT_E:-0}" -gt 0 ]; then
  MISSING_E="$(run "
    WITH want(e) AS (VALUES $(values_1 E))
    SELECT w.e FROM want w
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = w.e AND t.typtype = 'e')
     ORDER BY w.e")"
fi
if [ "${WANT_V:-0}" -gt 0 ]; then
  MISSING_V="$(run "
    WITH want(e, v) AS (VALUES $(values_2 V))
    SELECT w.e || '|' || w.v
      FROM want w
     WHERE EXISTS (
       SELECT 1 FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = w.e AND t.typtype = 'e')
       AND NOT EXISTS (
         SELECT 1 FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
           JOIN pg_enum en ON en.enumtypid = t.oid
          WHERE n.nspname = 'public' AND t.typname = w.e AND en.enumlabel = w.v)
     ORDER BY w.e, w.v")"
fi

# ── 3. Which migration would fix it, and is it registered ───────────────────
#
# The point of the report. Without this the reader has a list of names and the
# same investigation to do that produced this script.
registered() {
  [ -f "$DEPLOY" ] || { echo "?"; return; }
  if sed -n '/^REQUIRED_MIGRATIONS="/,/^"/p' "$DEPLOY" | grep -qxF "$1"; then
    echo yes
  else
    echo no
  fi
}

creates_table() {
  [ -d "$MIGRATIONS" ] || return
  grep -rlE "CREATE TABLE (IF NOT EXISTS )?\"?$1\"?" "$MIGRATIONS"/*/migration.sql 2>/dev/null |
    head -1 | awk -F/ '{print $(NF-1)}'
}

adds_column() {
  [ -d "$MIGRATIONS" ] || return
  # The table name and the column name in the same file is the strongest signal
  # available without parsing SQL. Reported as a lead, not a fact.
  grep -rlE "ADD COLUMN (IF NOT EXISTS )?\"?$2\"?" "$MIGRATIONS"/*/migration.sql 2>/dev/null |
    while IFS= read -r f; do
      if grep -qE "\"?$1\"?" "$f"; then echo "$f"; fi
    done | head -1 | awk -F/ '{print $(NF-1)}'
}

# ── 4. Report ────────────────────────────────────────────────────────────────
echo
echo "══════════════════════════════════════════════════════════════════════════"
echo "  WHAT schema.prisma EXPECTS AND THIS DATABASE DOES NOT HAVE"
echo "══════════════════════════════════════════════════════════════════════════"
echo
printf '  database   %s\n' "$DB_NAME"
printf '  host       %s\n' "$DB_HOST"
printf '  size       %s\n' "$DB_SIZE"
printf '  schema     %s tables, %s columns, %s enums, %s enum values\n' \
  "$WANT_T" "$WANT_C" "$WANT_E" "$WANT_V"
echo

DRIFT=0

if [ -n "$MISSING_T" ]; then
  DRIFT=1
  RED "  MISSING TABLES"
  echo
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    m="$(creates_table "$t")"
    printf '    %-52s ' "$t"
    if [ -n "$m" ]; then
      r="$(registered "$m")"
      if [ "$r" = "no" ]; then
        printf 'created by %s  ' "$m"; RED "NOT REGISTERED with the deploy"
      else
        printf 'created by %s  (registered)\n' "$m"
      fi
    else
      YEL "no migration in this repo creates it"
    fi
  done <<< "$MISSING_T"
  echo
fi

if [ -n "$MISSING_C" ]; then
  DRIFT=1
  RED "  MISSING COLUMNS"
  DIM "  (only for tables that exist -- a missing table's columns are not listed twice)"
  echo
  while IFS='|' read -r t c; do
    [ -n "$t" ] || continue
    m="$(adds_column "$t" "$c")"
    printf '    %-52s ' "$t.$c"
    if [ -n "$m" ]; then
      r="$(registered "$m")"
      if [ "$r" = "no" ]; then
        printf 'added by %s  ' "$m"; RED "NOT REGISTERED with the deploy"
      else
        printf 'added by %s  (registered)\n' "$m"
      fi
    else
      YEL "no migration in this repo adds it"
    fi
  done <<< "$MISSING_C"
  echo
fi

if [ -n "$MISSING_E" ]; then
  DRIFT=1
  RED "  MISSING ENUM TYPES"
  echo
  printf '%s\n' "$MISSING_E" | sed '/^$/d; s/^/    /'
  echo
fi

if [ -n "$MISSING_V" ]; then
  DRIFT=1
  RED "  MISSING ENUM VALUES"
  DIM "  (the type exists; an insert using one of these values fails)"
  echo
  printf '%s\n' "$MISSING_V" | sed '/^$/d; s/|/  is missing  /; s/^/    /'
  echo
fi

if [ "$EXTRAS" -eq 1 ]; then
  EXTRA_T="$(run "
    WITH want(t) AS (VALUES $(values_1 T))
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname NOT IN (SELECT t FROM want)
       AND c.relname <> '_prisma_migrations'
     ORDER BY c.relname")"
  if [ -n "$EXTRA_T" ]; then
    YEL "  IN THE DATABASE, NOT IN THE SCHEMA"
    DIM "  (not necessarily wrong -- a renamed table leaves its old name here)"
    echo
    printf '%s\n' "$EXTRA_T" | sed '/^$/d; s/^/    /'
    echo
  fi
fi

echo "──────────────────────────────────────────────────────────────────────────"
if [ "$DRIFT" -eq 0 ]; then
  GRN "  In sync. Every table, column, enum and enum value the schema names is present."
  echo
  exit 0
fi

cat <<'NOTE'
  Anything marked NOT REGISTERED is the whole problem: the migration exists in
  this repository and scripts/deploy-netenroll.sh does not list it, so no deploy
  has ever applied it. Add it to REQUIRED_MIGRATIONS, in date order, with an
  applied-state probe beside it in migration_applied() -- the script refuses to
  apply SQL it cannot verify afterwards.

  Re-run this after deploying. It should print "In sync."
NOTE
echo
exit 1
