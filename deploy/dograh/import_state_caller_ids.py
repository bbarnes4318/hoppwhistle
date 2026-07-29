"""Idempotent importer: state-tagged Dograh outbound caller-ID DIDs.

Upserts numbers from a CSV (columns: number,state) into Dograh's
``telephony_phone_numbers`` table as active, non-default caller IDs for one
organization + telephony configuration. Numbers become part of the Dograh
from-number rotation pool automatically (the telephony factory loads all active
numbers for the config on each campaign batch).

Explicit pool designation: ``extra_metadata.pool = "state_cid"`` plus
``extra_metadata.state`` / ``.npa`` — the state-matched selection patch and
reporting key off the number itself; membership in this org+config is the
tenant/carrier authorization boundary (FracTEL egress via telephony config).

Safety:
- Dry-run by default; pass --apply to write.
- Never touches rows owned by a different organization (rejects with reason).
- Re-runnable: existing rows are metadata-merged, never duplicated
  (unique constraint on (organization_id, address_normalized)).
- Rejects malformed, non-US, toll-free, unknown-NPA, duplicate, and
  state-mismatched numbers with per-number reasons.

Run inside the dograh api container (or any env with asyncpg + DATABASE_URL):
  docker cp deploy/dograh/. dograh-api-1:/tmp/cid-import/
  docker exec dograh-api-1 python /tmp/cid-import/import_state_caller_ids.py \
      --csv /tmp/cid-import/dograh-state-caller-ids.csv --org-id 1 --tcid 1 [--apply]
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from areacode_state import (  # noqa: E402
    REASON_OK,
    normalize_us_e164,
    state_for_number,
)

POOL_TAG = "state_cid"


def load_rows(csv_path: str) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or "number" not in [c.strip() for c in reader.fieldnames]:
            raise SystemExit("CSV must have a 'number' column (optional 'state').")
        for raw in reader:
            number = (raw.get("number") or "").strip()
            state = (raw.get("state") or "").strip().upper()
            if number:
                rows.append((number, state))
    return rows


async def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--csv", required=True)
    p.add_argument("--org-id", type=int, default=1)
    p.add_argument("--tcid", type=int, default=1)
    p.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    p.add_argument("--label-prefix", default="State CID")
    args = p.parse_args()

    import asyncpg

    db_url = os.environ.get("DATABASE_URL", "")
    dsn = db_url.replace("postgresql+asyncpg://", "postgresql://")
    if not dsn:
        raise SystemExit("DATABASE_URL not set")

    supplied = load_rows(args.csv)
    report: dict = {
        "dry_run": not args.apply,
        "organization_id": args.org_id,
        "telephony_configuration_id": args.tcid,
        "total_supplied": len(supplied),
        "total_valid": 0,
        "inserted": 0,
        "updated": 0,
        "already_correct": 0,
        "rejected": [],
        "duplicates": [],
        "unknown_state": [],
        "state_inventory": {},
    }

    seen: set[str] = set()
    valid: list[tuple[str, str, str]] = []  # (e164, npa, state)
    for number, declared_state in supplied:
        e164 = normalize_us_e164(number)
        if not e164:
            report["rejected"].append({"number": number, "reason": "MALFORMED_OR_NON_US"})
            continue
        if e164 in seen:
            report["duplicates"].append(e164)
            continue
        seen.add(e164)
        state, reason = state_for_number(e164)
        if reason != REASON_OK or not state:
            report["rejected"].append({"number": e164, "reason": reason})
            if reason == "UNKNOWN_OR_UNSUPPORTED_AREA_CODE":
                report["unknown_state"].append(e164)
            continue
        if declared_state and declared_state != state:
            report["rejected"].append(
                {
                    "number": e164,
                    "reason": f"STATE_MISMATCH declared={declared_state} canonical={state}",
                }
            )
            continue
        valid.append((e164, e164[2:5], state))

    report["total_valid"] = len(valid)

    conn = await asyncpg.connect(dsn=dsn)
    try:
        now = datetime.now(timezone.utc)
        state_counts: Counter[str] = Counter()
        for e164, npa, state in valid:
            rows = await conn.fetch(
                "select id, organization_id, telephony_configuration_id, is_active, "
                "label, extra_metadata from telephony_phone_numbers "
                "where address_normalized = $1",
                e164,
            )
            other_org = [r for r in rows if r["organization_id"] != args.org_id]
            mine = [r for r in rows if r["organization_id"] == args.org_id]
            if other_org and not mine:
                report["rejected"].append(
                    {"number": e164, "reason": "OWNED_BY_OTHER_ORGANIZATION"}
                )
                continue

            desired_label = f"{args.label_prefix} {state}"
            if mine:
                row = mine[0]
                meta = row["extra_metadata"]
                if isinstance(meta, str):
                    meta = json.loads(meta or "{}")
                meta = meta or {}
                needs_update = (
                    meta.get("state") != state
                    or meta.get("npa") != npa
                    or meta.get("pool") != POOL_TAG
                    or not row["is_active"]
                    or (row["label"] or "").strip() != desired_label
                )
                if not needs_update:
                    report["already_correct"] += 1
                else:
                    if args.apply:
                        new_meta = {
                            **meta,
                            "state": state,
                            "npa": npa,
                            "pool": POOL_TAG,
                            "cid_import_at": now.isoformat(),
                        }
                        await conn.execute(
                            "update telephony_phone_numbers set "
                            "extra_metadata = $2::json, is_active = true, "
                            "label = $3, updated_at = $4 where id = $1",
                            row["id"],
                            json.dumps(new_meta),
                            desired_label,
                            now,
                        )
                    report["updated"] += 1
            else:
                if args.apply:
                    await conn.execute(
                        "insert into telephony_phone_numbers "
                        "(organization_id, telephony_configuration_id, address, "
                        "address_normalized, address_type, country_code, label, "
                        "is_active, is_default_caller_id, extra_metadata, "
                        "created_at, updated_at) values "
                        "($1,$2,$3,$3,'pstn','US',$4,true,false,$5::json,$6,$6)",
                        args.org_id,
                        args.tcid,
                        e164,
                        desired_label,
                        json.dumps(
                            {
                                "state": state,
                                "npa": npa,
                                "pool": POOL_TAG,
                                "cid_import_at": now.isoformat(),
                            }
                        ),
                        now,
                    )
                report["inserted"] += 1
            state_counts[state] += 1

        report["state_inventory"] = dict(sorted(state_counts.items()))

        # Post-apply validation: count what is actually active in the pool tag.
        if args.apply:
            actual = await conn.fetch(
                "select extra_metadata->>'state' as state, count(*) as n "
                "from telephony_phone_numbers "
                "where organization_id=$1 and telephony_configuration_id=$2 "
                "and is_active and extra_metadata->>'pool' = $3 "
                "group by 1 order by 1",
                args.org_id,
                args.tcid,
                POOL_TAG,
            )
            report["db_confirmed_pool_inventory"] = {r["state"]: r["n"] for r in actual}
            report["db_confirmed_pool_total"] = sum(r["n"] for r in actual)
    finally:
        await conn.close()

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
