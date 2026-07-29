"""Operational report: Dograh caller-ID pool grouped by state.

Prints JSON with: per-state active caller-ID counts, in-use vs free (live Redis
rotation pool), states with zero inventory, and numbers lacking state metadata.

Run inside the dograh api container:
  docker exec dograh-api-1 python /tmp/cid-import/pool_state_inventory.py --org-id 1 --tcid 1
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from areacode_state import AREA_CODE_TO_STATE, state_for_number  # noqa: E402

ALL_STATES = sorted(set(AREA_CODE_TO_STATE.values()))


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--org-id", type=int, default=1)
    p.add_argument("--tcid", type=int, default=1)
    args = p.parse_args()

    import asyncpg
    import redis.asyncio as aioredis

    dsn = os.environ.get("DATABASE_URL", "").replace(
        "postgresql+asyncpg://", "postgresql://"
    )
    conn = await asyncpg.connect(dsn=dsn)
    try:
        rows = await conn.fetch(
            "select address_normalized, is_active, is_default_caller_id, "
            "extra_metadata->>'state' as meta_state, extra_metadata->>'pool' as pool "
            "from telephony_phone_numbers "
            "where organization_id=$1 and telephony_configuration_id=$2",
            args.org_id,
            args.tcid,
        )
    finally:
        await conn.close()

    by_state: dict[str, dict] = {}
    missing_state_meta: list[str] = []
    for r in rows:
        if not r["is_active"]:
            continue
        state = r["meta_state"] or state_for_number(r["address_normalized"])[0]
        if not state:
            missing_state_meta.append(r["address_normalized"])
            continue
        if not r["meta_state"]:
            missing_state_meta.append(r["address_normalized"])
        entry = by_state.setdefault(
            state, {"total": 0, "state_cid_pool": 0, "numbers": []}
        )
        entry["total"] += 1
        if r["pool"] == "state_cid":
            entry["state_cid_pool"] += 1
        entry["numbers"].append(r["address_normalized"])

    in_use: list[str] = []
    free_count = 0
    try:
        redis_url = os.environ.get("REDIS_URL", "redis://redis:6379")
        rc = await aioredis.from_url(redis_url, decode_responses=True)
        pool_key = f"from_number_pool:{args.org_id}:{args.tcid}"
        members = await rc.zrange(pool_key, 0, -1, withscores=True)
        for member, score in members:
            if score and float(score) > 0:
                in_use.append(member)
            else:
                free_count += 1
        await rc.aclose()
    except Exception as e:  # Redis optional for this report
        in_use = [f"<redis unavailable: {e}>"]

    report = {
        "organization_id": args.org_id,
        "telephony_configuration_id": args.tcid,
        "total_active_caller_ids": sum(v["total"] for v in by_state.values()),
        "by_state": {
            s: {"total": v["total"], "state_cid_pool": v["state_cid_pool"]}
            for s, v in sorted(by_state.items())
        },
        "states_with_zero_inventory": [s for s in ALL_STATES if s not in by_state],
        "numbers_missing_state_metadata": missing_state_meta,
        "live_rotation": {"free": free_count, "in_use_count": len(in_use)},
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
