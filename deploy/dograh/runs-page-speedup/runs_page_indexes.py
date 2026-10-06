#!/usr/bin/env python3
"""Add the indexes Dograh's call-results lists need. Run INSIDE dograh-api-1.

    docker cp runs_page_indexes.py dograh-api-1:/tmp/
    docker exec dograh-api-1 python /tmp/runs_page_indexes.py            # report only
    docker exec dograh-api-1 python /tmp/runs_page_indexes.py --apply    # build them

Every results list asks for "the newest 50 calls of X":

    WHERE workflow_id = $1  ORDER BY created_at DESC NULLS LAST LIMIT 50   -- agent runs
    WHERE campaign_id = $1  ORDER BY created_at DESC NULLS LAST LIMIT 50   -- campaign runs
    ... ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 50              -- Agent Runs / usage

``workflow_runs`` only has single-column indexes on ``workflow_id`` and
``campaign_id``, so Postgres has to visit every call the agent or campaign has
ever made and sort them all to find the newest 50 -- on every page load. These
composite indexes hand it the newest 50 directly. ``NULLS LAST`` matches what
Dograh's ORDER BY says; without it Postgres cannot use the index for the sort.
``INCLUDE (id)`` lets the "N calls total" count under each list (``count(id)``)
be answered from the index alone instead of reading every call's row.

Built ``CONCURRENTLY``: calls keep being written while they build, nothing is
locked, no restart. Safe to re-run: a valid index is left alone, one left
invalid by an interrupted build is dropped and rebuilt.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time

INDEXES = [
    (
        "hw_idx_workflow_runs_workflow_created",
        "ON workflow_runs (workflow_id, created_at DESC NULLS LAST) INCLUDE (id)",
    ),
    (
        "hw_idx_workflow_runs_campaign_created",
        "ON workflow_runs (campaign_id, created_at DESC NULLS LAST) INCLUDE (id) "
        "WHERE campaign_id IS NOT NULL",
    ),
    (
        "hw_idx_workflow_runs_created_id",
        "ON workflow_runs (created_at DESC NULLS LAST, id DESC)",
    ),
]


def dsn_from_env() -> str:
    dsn = os.environ.get("DATABASE_URL", "")
    return dsn.replace("postgresql+asyncpg://", "postgresql://").replace("postgres+asyncpg://", "postgresql://")


async def index_state(conn, name: str):
    """None if absent, else True/False for valid/invalid."""
    row = await conn.fetchrow(
        "SELECT i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid "
        "WHERE c.relname = $1 AND c.relkind = 'i'",
        name,
    )
    return None if row is None else bool(row["indisvalid"])


async def report(conn) -> None:
    stats = await conn.fetchrow(
        "SELECT count(*) AS runs, pg_size_pretty(pg_total_relation_size('workflow_runs')) AS size "
        "FROM workflow_runs"
    )
    print(f"workflow_runs: {stats['runs']} calls, {stats['size']} on disk (with logs/TOAST)")
    sample = await conn.fetchrow(
        "SELECT pg_size_pretty(avg(pg_column_size(logs))::bigint) AS logs, "
        "pg_size_pretty(avg(pg_column_size(gathered_context))::bigint) AS gathered "
        "FROM (SELECT logs, gathered_context FROM workflow_runs ORDER BY id DESC LIMIT 200) s"
    )
    print(f"recent calls, average stored size: logs {sample['logs']}, gathered_context {sample['gathered']}")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="build missing indexes (default: report only)")
    args = parser.parse_args()

    dsn = dsn_from_env()
    if not dsn:
        print("DATABASE_URL is not set. Run this inside the dograh api container.", file=sys.stderr)
        return 1
    import asyncpg

    conn = await asyncpg.connect(dsn=dsn)
    try:
        await report(conn)
        # A concurrent build of a big table can outlast any default timeout.
        await conn.execute("SET statement_timeout = 0")
        missing = 0
        for name, definition in INDEXES:
            state = await index_state(conn, name)
            if state is True:
                print(f"  {name}: present")
                continue
            missing += 1
            if not args.apply:
                print(f"  {name}: {'INVALID (interrupted build)' if state is False else 'missing'} -- would build")
                continue
            if state is False:
                await conn.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
            started = time.monotonic()
            print(f"  {name}: building...", flush=True)
            await conn.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} {definition}")
            if await index_state(conn, name) is not True:
                print(f"  {name}: build did not finish valid; re-run this script", file=sys.stderr)
                return 2
            print(f"  {name}: built in {time.monotonic() - started:.1f}s")
        if args.apply and missing:
            await conn.execute("ANALYZE workflow_runs")
            print("  statistics refreshed (ANALYZE workflow_runs)")
        if not args.apply and missing:
            print("Dry run: nothing built. Add --apply.")
    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
