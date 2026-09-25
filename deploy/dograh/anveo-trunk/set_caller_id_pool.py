"""Limit a Dograh telephony configuration's caller IDs to a fixed list, and
slow a campaign down, reversibly.

Anveo refuses calls whose caller ID is not one of our Anveo DIDs, and we only
have a few, so AI calls sent over the Anveo trunk must rotate over exactly
those numbers and go out slowly. This script:

  * deactivates every other active caller ID on the configuration (it does not
    delete them) and activates/inserts the listed numbers, tagged
    ``extra_metadata.pool = "anveo"``;
  * optionally sets a campaign's ``rate_limit_per_second``,
    ``orchestrator_metadata.max_concurrency`` and turns
    ``orchestrator_metadata.state_cid_policy`` off (a same-state policy would
    strand calls to states the few numbers do not cover).

Everything it changes is written to a backup JSON (also printed), and
``--restore`` puts it all back.

Dry run by default. Run inside the dograh api container (it needs asyncpg and
DATABASE_URL), the same way as import_state_caller_ids.py:

  docker cp deploy/dograh/anveo-trunk/set_caller_id_pool.py dograh-api-1:/tmp/
  docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --tcid 1 --campaign-id 7
  docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --tcid 1 --campaign-id 7 --apply
  docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --restore /tmp/anveo-pool-backup.json --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from datetime import datetime, timezone
from typing import List, Optional

DEFAULT_NUMBERS = ["+18652809894", "+18652809893", "+18652809892"]
POOL_TAG = "anveo"


def to_e164(raw: str) -> Optional[str]:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01":
        return None
    return "+1" + digits


def parse_numbers(values: List[str]) -> List[str]:
    out: List[str] = []
    for value in values:
        for part in re.split(r"[,\s]+", value):
            if not part:
                continue
            e164 = to_e164(part)
            if not e164:
                raise SystemExit(f"Not a US number: {part!r}")
            if e164 not in out:
                out.append(e164)
    return out


def as_dict(meta) -> dict:
    if isinstance(meta, str):
        meta = json.loads(meta or "{}")
    return dict(meta or {})


async def connect():
    import asyncpg

    dsn = os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
    if not dsn:
        raise SystemExit("DATABASE_URL not set")
    return await asyncpg.connect(dsn=dsn)


async def apply_pool(args) -> int:
    numbers = parse_numbers(args.numbers or DEFAULT_NUMBERS)
    now = datetime.now(timezone.utc)
    conn = await connect()
    backup = {
        "created_at": now.isoformat(),
        "organization_id": args.org_id,
        "telephony_configuration_id": args.tcid,
        "deactivated_ids": [],
        "activated_ids": [],
        "inserted_ids": [],
        "campaign": None,
    }
    try:
        active = await conn.fetch(
            "select id, address_normalized from telephony_phone_numbers "
            "where organization_id=$1 and telephony_configuration_id=$2 and is_active",
            args.org_id,
            args.tcid,
        )
        to_deactivate = [r for r in active if r["address_normalized"] not in numbers]
        print(f"Config {args.tcid}: {len(active)} active caller IDs; "
              f"{len(to_deactivate)} would be deactivated, keeping only {', '.join(numbers)}")

        plan = []
        for e164 in numbers:
            rows = await conn.fetch(
                "select id, organization_id, telephony_configuration_id, is_active, extra_metadata "
                "from telephony_phone_numbers where address_normalized=$1",
                e164,
            )
            mine = [r for r in rows if r["organization_id"] == args.org_id]
            if rows and not mine:
                raise SystemExit(f"{e164} belongs to another Dograh organization; refusing.")
            here = [r for r in mine if r["telephony_configuration_id"] == args.tcid]
            if here:
                action = "already active" if here[0]["is_active"] else "activate"
                plan.append((e164, action, here[0]))
            elif mine:
                # Unique per (organization, number): it lives on another config.
                raise SystemExit(f"{e164} is on telephony configuration "
                                 f"{mine[0]['telephony_configuration_id']}, not {args.tcid}; move it first.")
            else:
                plan.append((e164, "insert", None))
        for e164, action, _ in plan:
            print(f"  {e164}: {action}")

        campaign = None
        if args.campaign_id is not None:
            campaign = await conn.fetchrow(
                "select id, telephony_configuration_id, rate_limit_per_second, orchestrator_metadata "
                "from campaigns where id=$1 and organization_id=$2",
                args.campaign_id,
                args.org_id,
            )
            if not campaign:
                raise SystemExit(f"Campaign {args.campaign_id} not found in organization {args.org_id}.")
            meta = as_dict(campaign["orchestrator_metadata"])
            print(f"Campaign {campaign['id']} (telephony config {campaign['telephony_configuration_id']}): "
                  f"rate_limit_per_second {campaign['rate_limit_per_second']} -> {args.rate}, "
                  f"max_concurrency {meta.get('max_concurrency')} -> {args.max_concurrency}, "
                  f"state_cid_policy {meta.get('state_cid_policy')} -> off")
            if campaign["telephony_configuration_id"] != args.tcid:
                print(f"WARNING: the campaign uses telephony configuration "
                      f"{campaign['telephony_configuration_id']}, not {args.tcid}.")

        if not args.apply:
            print("\nDry run. Nothing changed. Re-run with --apply.")
            return 0

        async with conn.transaction():
            for r in to_deactivate:
                await conn.execute(
                    "update telephony_phone_numbers set is_active=false, updated_at=$2 where id=$1",
                    r["id"], now,
                )
                backup["deactivated_ids"].append(r["id"])
            for e164, action, row in plan:
                if action == "activate":
                    meta = {**as_dict(row["extra_metadata"]), "pool": POOL_TAG}
                    await conn.execute(
                        "update telephony_phone_numbers set is_active=true, extra_metadata=$2::json, "
                        "updated_at=$3 where id=$1",
                        row["id"], json.dumps(meta), now,
                    )
                    backup["activated_ids"].append(row["id"])
                elif action == "insert":
                    new_id = await conn.fetchval(
                        "insert into telephony_phone_numbers "
                        "(organization_id, telephony_configuration_id, address, address_normalized, "
                        "address_type, country_code, label, is_active, is_default_caller_id, "
                        "extra_metadata, created_at, updated_at) values "
                        "($1,$2,$3,$3,'pstn','US',$4,true,false,$5::json,$6,$6) returning id",
                        args.org_id, args.tcid, e164, "Anveo CID",
                        json.dumps({"pool": POOL_TAG, "npa": e164[2:5]}), now,
                    )
                    backup["inserted_ids"].append(new_id)
            if campaign:
                meta = as_dict(campaign["orchestrator_metadata"])
                backup["campaign"] = {
                    "id": campaign["id"],
                    "rate_limit_per_second": campaign["rate_limit_per_second"],
                    "orchestrator_metadata": meta,
                }
                new_meta = {**meta, "max_concurrency": args.max_concurrency, "state_cid_policy": "off"}
                await conn.execute(
                    "update campaigns set rate_limit_per_second=$2, orchestrator_metadata=$3::json where id=$1",
                    campaign["id"], args.rate, json.dumps(new_meta),
                )

        with open(args.backup, "w", encoding="utf-8") as handle:
            json.dump(backup, handle, indent=2, default=str)
        print(f"\nApplied. Backup written to {args.backup} (copy it off the container):")
        print(json.dumps(backup, indent=2, default=str))
        active_now = await conn.fetch(
            "select address_normalized from telephony_phone_numbers "
            "where organization_id=$1 and telephony_configuration_id=$2 and is_active order by 1",
            args.org_id, args.tcid,
        )
        print("Active caller IDs now:", ", ".join(r["address_normalized"] for r in active_now))
    finally:
        await conn.close()
    return 0


async def restore(args) -> int:
    with open(args.restore, encoding="utf-8") as handle:
        backup = json.load(handle)
    reactivate = backup.get("deactivated_ids", [])
    turn_off = backup.get("activated_ids", []) + backup.get("inserted_ids", [])
    campaign = backup.get("campaign")
    print(f"Restore: reactivate {len(reactivate)} caller IDs, deactivate {len(turn_off)} Anveo ones"
          + (f", put campaign {campaign['id']} back" if campaign else ""))
    if not args.apply:
        print("Dry run. Nothing changed. Re-run with --apply.")
        return 0
    now = datetime.now(timezone.utc)
    conn = await connect()
    try:
        async with conn.transaction():
            if reactivate:
                await conn.execute(
                    "update telephony_phone_numbers set is_active=true, updated_at=$2 where id = any($1::int[])",
                    reactivate, now,
                )
            if turn_off:
                await conn.execute(
                    "update telephony_phone_numbers set is_active=false, updated_at=$2 where id = any($1::int[])",
                    turn_off, now,
                )
            if campaign:
                await conn.execute(
                    "update campaigns set rate_limit_per_second=$2, orchestrator_metadata=$3::json where id=$1",
                    campaign["id"], campaign["rate_limit_per_second"],
                    json.dumps(campaign["orchestrator_metadata"]),
                )
    finally:
        await conn.close()
    print("Restored.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--org-id", type=int, default=1)
    p.add_argument("--tcid", type=int, default=1, help="Dograh telephony configuration id")
    p.add_argument("--numbers", nargs="*", help=f"caller IDs to keep (default: {' '.join(DEFAULT_NUMBERS)})")
    p.add_argument("--campaign-id", type=int)
    p.add_argument("--rate", type=int, default=1, help="campaign rate_limit_per_second (default 1)")
    p.add_argument("--max-concurrency", type=int, default=3, help="campaign concurrent calls (default 3)")
    p.add_argument("--backup", default="/tmp/anveo-pool-backup.json")
    p.add_argument("--restore", metavar="BACKUP_JSON")
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()
    if args.rate < 1 or args.max_concurrency < 1:
        raise SystemExit("--rate and --max-concurrency must be at least 1")
    return asyncio.run(restore(args) if args.restore else apply_pool(args))


if __name__ == "__main__":
    raise SystemExit(main())
