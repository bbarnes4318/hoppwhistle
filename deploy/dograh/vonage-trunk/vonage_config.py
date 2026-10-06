"""Give Vonage its own Dograh telephony configuration, beside FracTEL's.

Dograh keeps one caller-ID pool per telephony configuration, and each campaign
uses one configuration. A second ARI configuration holding only the Vonage
numbers therefore lets one campaign dial from Vonage numbers while another
keeps FracTEL's, at the same time. The ARI caller-trunk patch
(deploy/dograh/ari-trunk/apply_caller_trunk_patch.py) then sends each call to
the trunk its caller ID belongs to.

Run inside the dograh api container (asyncpg, DATABASE_URL), like
set_caller_id_pool.py. Credential columns are never printed.

  python vonage_config.py ensure-config --source-tcid 1 --name Vonage
  python vonage_config.py move-numbers --tcid 3 --numbers +12017785210 ...
  python vonage_config.py list-campaigns
  python vonage_config.py assign-campaign --campaign-id 7 --tcid 3 --backup /tmp/vonage-campaign-backup.json
  python vonage_config.py restore --backup /tmp/vonage-campaign-backup.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from typing import Dict, List, Optional


def last10(number: str) -> Optional[str]:
    digits = re.sub(r"\D", "", number or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def copy_expressions(columns: List[Dict[str, str]]) -> Dict[str, str]:
    """{column: SQL expression} copying a telephony_configurations row.

    $1 is the source id, $2 the new name. The id and generated columns are
    left to their defaults, timestamps are now(), and any boolean "default"
    flag is false so the copy never becomes the default configuration.
    """
    out = {}
    for c in columns:
        name, dtype = c["column_name"], c["data_type"]
        if name == "id" or c.get("is_generated") == "ALWAYS" or c.get("identity_generation"):
            continue
        if name == "name":
            out[name] = "$2"
        elif name in ("created_at", "updated_at"):
            out[name] = "now()"
        elif dtype == "boolean" and "default" in name:
            out[name] = "false"
        else:
            out[name] = f'"{name}"'
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


async def columns(conn, table: str) -> List[Dict[str, str]]:
    rows = await conn.fetch(
        "select column_name, data_type, is_generated, identity_generation "
        "from information_schema.columns where table_name=$1 order by ordinal_position",
        table,
    )
    return [dict(r) for r in rows]


async def ensure_config(args) -> int:
    conn = await connect()
    try:
        cols = await columns(conn, "telephony_configurations")
        names = {c["column_name"] for c in cols}
        if "name" not in names or "organization_id" not in names:
            raise SystemExit("telephony_configurations has no name/organization_id column; refusing.")
        existing = await conn.fetchrow(
            "select id from telephony_configurations where organization_id=$1 and name=$2 order by id limit 1",
            args.org_id, args.name,
        )
        if existing:
            print(f"TCID={existing['id']}")
            print(f"Configuration {args.name!r} already exists (id {existing['id']}).")
            return 0
        source = await conn.fetchrow(
            "select id, organization_id from telephony_configurations where id=$1", args.source_tcid
        )
        if not source or source["organization_id"] != args.org_id:
            raise SystemExit(f"Configuration {args.source_tcid} not found in organization {args.org_id}.")
        exprs = copy_expressions(cols)
        quoted = ", ".join(f'"{c}"' for c in exprs)
        new_id = await conn.fetchval(
            f"insert into telephony_configurations ({quoted}) "
            f"select {', '.join(exprs.values())} from telephony_configurations where id=$1 returning id",
            args.source_tcid, args.name,
        )
        print(f"TCID={new_id}")
        print(f"Created configuration {args.name!r} (id {new_id}) as a copy of {args.source_tcid}.")
    finally:
        await conn.close()
    return 0


async def move_numbers(args) -> int:
    """Move these numbers' rows onto --tcid. Refuses a number active elsewhere."""
    conn = await connect()
    try:
        moved = 0
        for raw in args.numbers:
            ten = last10(raw)
            if not ten:
                raise SystemExit(f"Not a US number: {raw!r}")
            e164 = "+1" + ten
            rows = await conn.fetch(
                "select id, telephony_configuration_id, is_active from telephony_phone_numbers "
                "where organization_id=$1 and address_normalized=$2",
                args.org_id, e164,
            )
            for r in rows:
                if r["telephony_configuration_id"] == args.tcid:
                    continue
                if r["is_active"]:
                    raise SystemExit(
                        f"{e164} is ACTIVE on configuration {r['telephony_configuration_id']}. Put that "
                        "configuration's caller IDs back first (set_caller_id_pool.py --restore)."
                    )
                await conn.execute(
                    "update telephony_phone_numbers set telephony_configuration_id=$2, updated_at=now() where id=$1",
                    r["id"], args.tcid,
                )
                moved += 1
        print(f"Moved {moved} inactive number row(s) onto configuration {args.tcid}.")
    finally:
        await conn.close()
    return 0


async def list_campaigns(args) -> int:
    conn = await connect()
    try:
        names = {c["column_name"] for c in await columns(conn, "campaigns")}
        shown = ["id"] + [c for c in ("name", "state", "status", "telephony_configuration_id") if c in names]
        rows = await conn.fetch(
            f"select {', '.join(shown)} from campaigns where organization_id=$1 order by id desc limit 40",
            args.org_id,
        )
        for r in rows:
            print("  ".join(f"{c}={r[c]}" for c in shown))
    finally:
        await conn.close()
    return 0


async def assign_campaign(args) -> int:
    """Put a campaign on --tcid with same-state caller ID off. Backed up first."""
    conn = await connect()
    try:
        row = await conn.fetchrow(
            "select id, telephony_configuration_id, orchestrator_metadata from campaigns "
            "where id=$1 and organization_id=$2",
            args.campaign_id, args.org_id,
        )
        if not row:
            raise SystemExit(f"Campaign {args.campaign_id} not found in organization {args.org_id}.")
        meta = as_dict(row["orchestrator_metadata"])
        backup = {
            "campaign_id": row["id"],
            "telephony_configuration_id": row["telephony_configuration_id"],
            "orchestrator_metadata": meta,
        }
        with open(args.backup, "w", encoding="utf-8") as handle:
            json.dump(backup, handle, indent=2, default=str)
        await conn.execute(
            "update campaigns set telephony_configuration_id=$2, orchestrator_metadata=$3::json where id=$1",
            row["id"], args.tcid, json.dumps({**meta, "state_cid_policy": "off"}),
        )
        print(f"Campaign {row['id']}: configuration {row['telephony_configuration_id']} -> {args.tcid}, "
              f"same-state caller ID off. Backup: {args.backup}")
    finally:
        await conn.close()
    return 0


async def restore(args) -> int:
    with open(args.backup, encoding="utf-8") as handle:
        backup = json.load(handle)
    conn = await connect()
    try:
        await conn.execute(
            "update campaigns set telephony_configuration_id=$2, orchestrator_metadata=$3::json where id=$1",
            backup["campaign_id"], backup["telephony_configuration_id"],
            json.dumps(backup["orchestrator_metadata"]),
        )
        print(f"Campaign {backup['campaign_id']} back on configuration {backup['telephony_configuration_id']}.")
    finally:
        await conn.close()
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--org-id", type=int, default=1)
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("ensure-config")
    e.add_argument("--source-tcid", type=int, default=1)
    e.add_argument("--name", default="Vonage")
    m = sub.add_parser("move-numbers")
    m.add_argument("--tcid", type=int, required=True)
    m.add_argument("--numbers", nargs="+", required=True)
    sub.add_parser("list-campaigns")
    a = sub.add_parser("assign-campaign")
    a.add_argument("--campaign-id", type=int, required=True)
    a.add_argument("--tcid", type=int, required=True)
    a.add_argument("--backup", default="/tmp/vonage-campaign-backup.json")
    r = sub.add_parser("restore")
    r.add_argument("--backup", default="/tmp/vonage-campaign-backup.json")
    args = p.parse_args()
    handler = {
        "ensure-config": ensure_config, "move-numbers": move_numbers, "list-campaigns": list_campaigns,
        "assign-campaign": assign_campaign, "restore": restore,
    }[args.cmd]
    return asyncio.run(handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
