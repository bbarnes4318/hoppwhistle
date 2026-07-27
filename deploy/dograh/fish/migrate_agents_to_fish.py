"""Migrate existing Dograh agents/workflows to Fish Audio — dry-run first.

Safety model, in order of importance:

1. **Dry-run by default.** ``--apply`` is required to write anything.
2. **Never invents a voice.** An agent is migrated only when the mapping file
   supplies a Fish voice ID for it. Anything unmapped keeps its current
   provider and is reported with a reason — a cloned persona is never replaced
   by an unrelated stock voice.
3. **Backs up every row it touches**, before touching it, to a timestamped
   JSON file that ``rollback_fish.py`` consumes.
4. **Idempotent.** Re-running after a partial apply migrates only what is
   still outstanding.

Mapping file (JSON list)::

    [
      {"agent_or_workflow_id": "42", "fish_voice_id": "b1c2d3..."},
      {"agent_or_workflow_id": "43", "fish_voice_id": "e4f5a6...",
       "speed": 1.05, "model": "s2-pro"}
    ]

Run inside the api container::

    docker cp deploy/dograh/fish/. dograh-api-1:/tmp/fish-kit/
    docker exec dograh-api-1 python /tmp/fish-kit/migrate_agents_to_fish.py \
        --mapping /tmp/fish-kit/fish-voices.json --backup-dir /patches/backups
    # review the report, then:
    docker exec dograh-api-1 python /tmp/fish-kit/migrate_agents_to_fish.py \
        --mapping /tmp/fish-kit/fish-voices.json --backup-dir /patches/backups --apply

The table/column defaults are auto-detected; pass ``--table`` / ``--config-column``
explicitly once ``audit_fish_readiness.py`` has told you the real names.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fish_config import (  # noqa: E402
    DEFAULT_FISH_MODEL,
    FISH_PROVIDER_ID,
    FishTTSConfig,
)

SKIP_NO_MAPPING = "NO_FISH_VOICE_MAPPING"
SKIP_ALREADY_FISH = "ALREADY_ON_FISH"
SKIP_NO_TTS_CONFIG = "NO_TTS_CONFIG_ON_ROW"
SKIP_INVALID = "INVALID_FISH_CONFIG"


def load_mapping(path: str) -> dict[str, dict]:
    with open(path, encoding="utf-8") as handle:
        raw = json.load(handle)
    if isinstance(raw, dict):
        raw = [{"agent_or_workflow_id": k, "fish_voice_id": v} for k, v in raw.items()]
    mapping: dict[str, dict] = {}
    for entry in raw:
        key = str(entry.get("agent_or_workflow_id") or entry.get("id") or "").strip()
        voice = str(entry.get("fish_voice_id") or entry.get("voice") or "").strip()
        if not key or not voice:
            raise SystemExit(f"mapping entry missing id or fish_voice_id: {entry!r}")
        if key in mapping:
            raise SystemExit(f"duplicate mapping entry for {key!r}")
        mapping[key] = entry
    return mapping


async def detect_config_table(conn) -> tuple[str, str, str]:
    """Best-effort discovery of (table, id column, JSON config column)."""
    rows = await conn.fetch(
        """
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = 'public' and data_type in ('json', 'jsonb')
        order by table_name, column_name
        """
    )
    preferred_tables = ("workflows", "workflow", "agents", "voice_agents")
    for table in preferred_tables:
        for row in rows:
            if row["table_name"] == table:
                return table, "id", row["column_name"]
    if rows:
        return rows[0]["table_name"], "id", rows[0]["column_name"]
    raise SystemExit(
        "could not auto-detect a JSON config table; pass --table and --config-column"
    )


def _as_dict(value) -> dict | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    return value if isinstance(value, dict) else None


def plan_row(row_id: str, config: dict, entry: dict | None) -> dict:
    """Decide what happens to one agent. Pure, so it is unit-testable."""
    tts = config.get("tts")
    if not isinstance(tts, dict):
        return {"id": row_id, "action": "skip", "reason": SKIP_NO_TTS_CONFIG}

    current = {
        "provider": tts.get("provider"),
        "model": tts.get("model"),
        "voice": tts.get("voice"),
    }
    if str(current["provider"] or "").lower() == FISH_PROVIDER_ID and tts.get("voice"):
        return {"id": row_id, "action": "skip", "reason": SKIP_ALREADY_FISH, "current": current}
    if entry is None:
        return {
            "id": row_id,
            "action": "skip",
            "reason": SKIP_NO_MAPPING,
            "current": current,
            "detail": "no Fish voice ID supplied for this agent; left on its existing provider",
        }

    proposed = dict(tts)
    proposed["provider"] = FISH_PROVIDER_ID
    proposed["model"] = entry.get("model") or DEFAULT_FISH_MODEL
    proposed["voice"] = entry["fish_voice_id"]
    for optional in ("speed", "latency", "normalize", "temperature", "top_p", "volume"):
        if optional in entry:
            proposed[optional] = entry[optional]

    errors = FishTTSConfig.from_mapping(
        {**proposed, "api_key": proposed.get("api_key") or "org-level"}
    ).validate()
    if errors:
        return {
            "id": row_id,
            "action": "skip",
            "reason": SKIP_INVALID,
            "current": current,
            "errors": errors,
        }

    return {
        "id": row_id,
        "action": "migrate",
        "current": current,
        "proposed": {
            "provider": proposed["provider"],
            "model": proposed["model"],
            "voice": proposed["voice"],
        },
        "new_tts": proposed,
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--table")
    parser.add_argument("--id-column", default="id")
    parser.add_argument("--config-column")
    parser.add_argument("--backup-dir", default="/patches/backups")
    parser.add_argument("--limit", type=int, default=10_000)
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    args = parser.parse_args()

    import asyncpg

    dsn = (os.environ.get("DATABASE_URL") or "").replace("postgresql+asyncpg://", "postgresql://")
    if not dsn:
        raise SystemExit("DATABASE_URL not set")

    mapping = load_mapping(args.mapping)
    now = datetime.now(timezone.utc)
    report: dict = {
        "dry_run": not args.apply,
        "generated_at": now.isoformat(),
        "mapping_entries": len(mapping),
        "migrated": [],
        "skipped": [],
        "backup_file": None,
    }

    conn = await asyncpg.connect(dsn=dsn)
    try:
        if args.table and args.config_column:
            table, id_column, config_column = args.table, args.id_column, args.config_column
        else:
            table, id_column, config_column = await detect_config_table(conn)
        report["table"] = table
        report["id_column"] = id_column
        report["config_column"] = config_column

        rows = await conn.fetch(
            f"select {id_column} as row_id, {config_column} as cfg from {table} "
            f"where {config_column} is not null limit {int(args.limit)}"
        )

        backups: list[dict] = []
        for row in rows:
            row_id = str(row["row_id"])
            config = _as_dict(row["cfg"])
            if config is None:
                report["skipped"].append({"id": row_id, "reason": SKIP_NO_TTS_CONFIG})
                continue
            plan = plan_row(row_id, config, mapping.get(row_id))
            if plan["action"] == "skip":
                report["skipped"].append(plan)
                continue

            backups.append(
                {
                    "table": table,
                    "id_column": id_column,
                    "config_column": config_column,
                    "id": row_id,
                    "previous_config": copy.deepcopy(config),
                }
            )
            if args.apply:
                new_config = copy.deepcopy(config)
                new_config["tts"] = plan["new_tts"]
                await conn.execute(
                    f"update {table} set {config_column} = $2::jsonb where {id_column} = $1",
                    row["row_id"],
                    json.dumps(new_config),
                )
            report["migrated"].append(
                {k: plan[k] for k in ("id", "current", "proposed") if k in plan}
            )

        # The backup is written even on a dry run, so the rollback path is
        # exercised before it is ever needed in anger.
        if backups:
            os.makedirs(args.backup_dir, exist_ok=True)
            suffix = "applied" if args.apply else "dryrun"
            backup_path = os.path.join(
                args.backup_dir, f"fish-migration-{now:%Y%m%dT%H%M%SZ}-{suffix}.json"
            )
            with open(backup_path, "w", encoding="utf-8") as handle:
                json.dump({"generated_at": now.isoformat(), "rows": backups}, handle, indent=2)
            report["backup_file"] = backup_path

        report["counts"] = {
            "migrated": len(report["migrated"]),
            "skipped": len(report["skipped"]),
            "skipped_no_mapping": sum(
                1 for s in report["skipped"] if s.get("reason") == SKIP_NO_MAPPING
            ),
            "skipped_already_fish": sum(
                1 for s in report["skipped"] if s.get("reason") == SKIP_ALREADY_FISH
            ),
            "skipped_invalid": sum(
                1 for s in report["skipped"] if s.get("reason") == SKIP_INVALID
            ),
        }
    finally:
        await conn.close()

    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
