#!/usr/bin/env bash
#
# Which PostgreSQL data directory on this host holds the call history?
#
# ── Why this exists ──────────────────────────────────────────────────────────
#
# The application reads ONE database, at whatever `DATABASE_URL` names. A host
# that has been deployed to more than once can easily have more than one
# PostgreSQL data directory on it — a container recreated under a different
# compose project name gets a NEW volume and an EMPTY database, while the old
# volume stays exactly where it was with every row still in it. The portal then
# shows an empty ledger, and the data is a `docker volume ls` away.
#
# This is not hypothetical on this host: `scripts/deploy.sh` already carries a
# postflight check for it —
#
#     DATABASE DRIFT: postgres is on volume "$VOL", expected docker_postgres_data
#
# — which exists because the container has come up on the wrong volume before.
#
# So this script looks at every PostgreSQL data directory on the machine, not
# just the one in use, and reports how many calls each one holds.
#
# ── What it does to your data: nothing ───────────────────────────────────────
#
# A running container is queried in place, read-only, with SELECT COUNT.
#
# A volume with NO running container cannot be queried without a server, and
# starting PostgreSQL on a data directory writes to it (crash recovery, and the
# `pg_hba.conf` change needed to get in without the password). So this NEVER
# starts a server on your volume. It copies the volume to a scratch volume,
# starts the throwaway server on the COPY, reads it, and deletes the copy. The
# original is only ever read.
#
#   sudo ./scripts/find-call-history.sh
#   sudo ./scripts/find-call-history.sh --no-copy    # running containers only
#
# Copying needs free disk equal to the volume's size. The script prints each
# size before it starts and skips anything that will not fit, so it cannot fill
# the disk out from under the running system.

set -uo pipefail

NO_COPY=0
for arg in "$@"; do
  case "$arg" in
    --no-copy) NO_COPY=1 ;;
    -h|--help) sed -n '2,44p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "Cannot talk to Docker. Run this on the host, with sudo." >&2
  exit 1
fi

RED() { printf '\033[31m%s\033[0m\n' "$*"; }
GRN() { printf '\033[32m%s\033[0m\n' "$*"; }
DIM() { printf '\033[2m%s\033[0m\n' "$*"; }

# The query. Deliberately defensive: a data directory from a different point in
# this schema's history may not have every table, and `to_regclass` returns NULL
# rather than raising for one that is absent.
read -r -d '' COUNT_SQL <<'SQL'
SELECT
  COALESCE((SELECT count(*) FROM calls), 0) AS calls,
  COALESCE((SELECT to_char(min("createdAt"), 'YYYY-MM-DD') FROM calls), '-') AS earliest,
  COALESCE((SELECT to_char(max("createdAt"), 'YYYY-MM-DD') FROM calls), '-') AS latest,
  COALESCE((SELECT count(*) FROM recordings), 0) AS recordings
WHERE to_regclass('public.calls') IS NOT NULL;
SQL

RESULTS=()

# ── Report one database inside one reachable server ─────────────────────────
probe_database() {
  local container="$1" dbname="$2" label="$3" psql_user="$4"

  local row
  row="$(docker exec "$container" psql -U "$psql_user" -d "$dbname" -At -F'|' \
          -c "$COUNT_SQL" 2>/dev/null | head -1)"

  if [ -z "$row" ]; then
    DIM "      $dbname: no calls table"
    return
  fi

  local calls earliest latest recordings
  IFS='|' read -r calls earliest latest recordings <<<"$row"

  printf '      %-24s %10s calls  %10s recordings   %s → %s\n' \
    "$dbname" "$calls" "$recordings" "$earliest" "$latest"

  RESULTS+=("$calls|$label|$dbname|$earliest|$latest|$recordings")
}

# Every non-template database in a reachable server.
probe_server() {
  local container="$1" label="$2" psql_user="$3"

  local dbs
  dbs="$(docker exec "$container" psql -U "$psql_user" -d postgres -At \
          -c "SELECT datname FROM pg_database WHERE datistemplate = false" 2>/dev/null)"

  if [ -z "$dbs" ]; then
    RED "      could not list databases as user '$psql_user'"
    return 1
  fi

  local db
  while IFS= read -r db; do
    [ -n "$db" ] && probe_database "$container" "$db" "$label" "$psql_user"
  done <<<"$dbs"
}

# The superuser this server will accept. Deploy docs name `callfabric`; images
# default to `postgres`. Try what the container itself says it was built with
# before guessing.
superuser_of() {
  local container="$1"
  local u
  u="$(docker exec "$container" printenv POSTGRES_USER 2>/dev/null)"
  [ -n "$u" ] && { echo "$u"; return; }
  for u in postgres callfabric hopwhistle; do
    if docker exec "$container" psql -U "$u" -d postgres -At -c 'SELECT 1' >/dev/null 2>&1; then
      echo "$u"; return
    fi
  done
  echo ""
}

echo
echo "══════════════════════════════════════════════════════════════════════"
echo "  POSTGRESQL DATA DIRECTORIES ON THIS HOST"
echo "══════════════════════════════════════════════════════════════════════"
echo

# ── 1. Running PostgreSQL containers, queried where they stand ───────────────
echo "RUNNING CONTAINERS"
echo

RUNNING_VOLUMES=""
mapfile -t running < <(docker ps --format '{{.ID}} {{.Names}} {{.Image}}' | grep -i postgres || true)

if [ ${#running[@]} -eq 0 ]; then
  DIM "  (none)"
else
  for entry in "${running[@]}"; do
    cid="${entry%% *}"; rest="${entry#* }"; name="${rest%% *}"; image="${rest#* }"
    vol="$(docker inspect "$cid" --format '{{range .Mounts}}{{.Name}} {{end}}' 2>/dev/null | tr -d ' ')"
    RUNNING_VOLUMES="$RUNNING_VOLUMES $vol"

    echo "  $name   [$image]   volume: ${vol:-<bind mount or none>}"
    user="$(superuser_of "$cid")"
    if [ -z "$user" ]; then
      RED "      could not authenticate; try: docker exec -it $name psql -U <user> -l"
      continue
    fi
    probe_server "$cid" "container $name (volume ${vol:-none})" "$user"
    echo
  done
fi

# ── 2. Volumes with no running server ────────────────────────────────────────
echo "VOLUMES WITH NO RUNNING SERVER"
echo

mapfile -t all_volumes < <(docker volume ls -q)
CANDIDATES=()

for vol in "${all_volumes[@]}"; do
  case " $RUNNING_VOLUMES " in *" $vol "*) continue ;; esac

  # A PostgreSQL data directory always has PG_VERSION at its root. Anything
  # else is somebody's redis dump or a node_modules cache.
  version="$(docker run --rm -v "$vol":/v:ro alpine:3 sh -c 'cat /v/PG_VERSION 2>/dev/null' 2>/dev/null | tr -d '[:space:]')"
  [ -n "$version" ] || continue

  size="$(docker run --rm -v "$vol":/v:ro alpine:3 sh -c 'du -sh /v 2>/dev/null | cut -f1' 2>/dev/null)"
  echo "  $vol   PostgreSQL $version   $size"
  CANDIDATES+=("$vol|$version|$size")
done

if [ ${#CANDIDATES[@]} -eq 0 ]; then
  DIM "  (none — every PostgreSQL volume on this host is attached to a running container)"
  echo
elif [ "$NO_COPY" -eq 1 ]; then
  echo
  DIM "  --no-copy given; not reading these. Re-run without it to count their calls."
  echo
else
  echo
  for candidate in "${CANDIDATES[@]}"; do
    IFS='|' read -r vol version size <<<"$candidate"

    echo "  ── reading $vol (PostgreSQL $version, $size) ───────────────"

    # Free space check. The copy is the whole data directory; filling the disk
    # on a live host is a worse outcome than not reading one volume.
    need_kb="$(docker run --rm -v "$vol":/v:ro alpine:3 sh -c 'du -sk /v 2>/dev/null | cut -f1' 2>/dev/null)"
    free_kb="$(df -Pk /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')"
    if [ -n "$need_kb" ] && [ -n "$free_kb" ] && [ "$need_kb" -ge "$free_kb" ]; then
      RED "      not enough free disk to copy this volume ($size needed). Skipped."
      echo
      continue
    fi

    scratch="callhistory_scratch_$$_${vol}"
    probe="callhistory_probe_$$"

    cleanup_probe() {
      docker rm -f "$probe" >/dev/null 2>&1
      docker volume rm "$scratch" >/dev/null 2>&1
    }

    docker volume create "$scratch" >/dev/null 2>&1

    # The copy. THE ORIGINAL IS MOUNTED READ-ONLY — this is the line that makes
    # the whole procedure safe, and it should stay `:ro` forever.
    if ! docker run --rm -v "$vol":/src:ro -v "$scratch":/dst alpine:3 \
           sh -c 'cp -a /src/. /dst/ 2>/dev/null'; then
      RED "      copy failed"; cleanup_probe; echo; continue
    fi

    # Trust auth ON THE COPY, because the password for this old cluster is not
    # something this script can know. Never done to the original.
    docker run --rm -v "$scratch":/dst alpine:3 sh -c '
      printf "local all all trust\nhost all all 0.0.0.0/0 trust\nhost all all ::/0 trust\n" > /dst/pg_hba.conf
      rm -f /dst/postmaster.pid
    ' >/dev/null 2>&1

    if ! docker run -d --name "$probe" -v "$scratch":/var/lib/postgresql/data \
           -e POSTGRES_HOST_AUTH_METHOD=trust \
           "postgres:${version}-alpine" >/dev/null 2>&1; then
      RED "      could not start postgres:${version}-alpine on the copy"
      cleanup_probe; echo; continue
    fi

    # Recovery on a copy of a live volume takes a moment. Wait, don't guess.
    ready=0
    for _ in $(seq 1 60); do
      if docker exec "$probe" pg_isready -q >/dev/null 2>&1; then ready=1; break; fi
      sleep 1
    done

    if [ "$ready" -ne 1 ]; then
      RED "      server did not become ready; logs:"
      docker logs --tail 15 "$probe" 2>&1 | sed 's/^/        /'
      cleanup_probe; echo; continue
    fi

    user="$(superuser_of "$probe")"
    [ -n "$user" ] || user=postgres
    probe_server "$probe" "volume $vol (detached)" "$user"

    cleanup_probe
    echo
  done
fi

# ── 3. The answer ────────────────────────────────────────────────────────────
echo "══════════════════════════════════════════════════════════════════════"
echo "  WHERE THE CALL HISTORY IS"
echo "══════════════════════════════════════════════════════════════════════"
echo

if [ ${#RESULTS[@]} -eq 0 ]; then
  RED "  No database with a calls table was found on this host."
  echo "  Every PostgreSQL volume was checked. If the history is not here, it is"
  echo "  on another machine, in a dump file, or in a snapshot."
  echo
  exit 0
fi

printf '%s\n' "${RESULTS[@]}" | sort -t'|' -k1 -rn | while IFS='|' read -r calls label dbname earliest latest recordings; do
  printf '  %12s calls  %10s recordings  %s → %s\n' "$calls" "$recordings" "$earliest" "$latest"
  printf '               in database "%s"\n' "$dbname"
  printf '               %s\n\n' "$label"
done

GRN "  The top row is the database holding the most call history."
echo
echo "  If that is NOT the one the application reads, do not move the application"
echo "  to it and do not delete anything. Copy the history across instead:"
echo
echo "    pnpm --filter @hopwhistle/api calls:inventory            # what the app reads now"
echo "    pnpm --filter @hopwhistle/api calls:restore -- --from <the other one> \\"
echo "        --into-tenant <agency id>          # dry run; add --commit when it looks right"
echo
echo "  The application's current database still holds every call since it was"
echo "  put into service, and those exist nowhere else. Never restore over it."
echo
