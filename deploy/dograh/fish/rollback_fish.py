"""Restore agent TTS configuration from a Fish migration backup.

This is the per-agent rollback. It does **not** need a database restore, does
not rebuild anything, and does not destroy the Fish voice mappings — it simply
writes each row's previous config back.

For a *fleet-wide* rollback that does not touch any row at all, flip the
provider selection instead (no writes, takes effect on the next call)::

    # in /opt/dograh/docker-compose.override.yaml, services.api.environment
    PRIMARY_TTS_PROVIDER=<previous-provider>
    FISH_TTS_CANARY_PERCENT=0
    cd /opt/dograh && docker compose up -d api

Per-agent rollback::

    docker exec dograh-api-1 python /tmp/fish-kit/rollback_fish.py \
        --backup /patches/backups/fish-migration-20260727T101500Z-applied.json   # dry run
    docker exec dograh-api-1 python /tmp/fish-kit/rollback_fish.py \
        --backup /patches/backups/fish-migration-20260727T101500Z-applied.json --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", required=True)
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    parser.add_argument(
        "--only-id",
        action="append",
        default=[],
        help="restore just these row IDs (repeatable); default is every row in the backup",
    )
    args = parser.parse_args()

    import asyncpg

    dsn = (os.environ.get("DATABASE_URL") or "").replace("postgresql+asyncpg://", "postgresql://")
    if not dsn:
        raise SystemExit("DATABASE_URL not set")

    with open(args.backup, encoding="utf-8") as handle:
        backup = json.load(handle)

    rows = backup.get("rows") or []
    if args.only_id:
        wanted = set(args.only_id)
        rows = [row for row in rows if str(row["id"]) in wanted]

    report = {
        "dry_run": not args.apply,
        "backup": args.backup,
        "backup_generated_at": backup.get("generated_at"),
        "restored": [],
        "missing": [],
    }

    conn = await asyncpg.connect(dsn=dsn)
    try:
        for row in rows:
            table = row["table"]
            id_column = row["id_column"]
            config_column = row["config_column"]
            row_id = row["id"]
            previous = row["previous_config"]

            existing = await conn.fetchrow(
                f"select {config_column} as cfg from {table} where {id_column} = $1::text",
                str(row_id),
            )
            if existing is None:
                # The id column may not be text; retry with the raw value.
                existing = await conn.fetchrow(
                    f"select {config_column} as cfg from {table} where {id_column}::text = $1",
                    str(row_id),
                )
            if existing is None:
                report["missing"].append(row_id)
                continue

            previous_tts = (previous or {}).get("tts", {})
            if args.apply:
                await conn.execute(
                    f"update {table} set {config_column} = $2::jsonb "
                    f"where {id_column}::text = $1",
                    str(row_id),
                    json.dumps(previous),
                )
            report["restored"].append(
                {
                    "id": row_id,
                    "restored_provider": previous_tts.get("provider"),
                    "restored_model": previous_tts.get("model"),
                    "restored_voice": previous_tts.get("voice"),
                }
            )
    finally:
        await conn.close()

    report["counts"] = {"restored": len(report["restored"]), "missing": len(report["missing"])}
    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
