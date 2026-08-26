"""Idempotent importer: FracTEL inbound DIDs -> Dograh inbound workflow mapping.

Maps each DID in ``dograh-inbound-numbers.csv`` (columns: address,npa,batch) to a
Dograh workflow by writing ``telephony_phone_numbers`` rows carrying
``inbound_workflow_id``. Dograh's ARI handler resolves an inbound call with
``find_active_phone_number_for_inbound(org_id, called_number, "ari")``, which
matches on ``address_normalized`` + ``is_active`` + the connection's telephony
config, then dials ``inbound_workflow_id``. There is no catch-all: a DID with no
row, or a row with no ``inbound_workflow_id``, is hung up.

Addresses are written in E.164 (``+1`` + 10 digits) for both ``address`` and
``address_normalized``. Dograh's ``normalize_telephony_address()`` runs without a
country hint, so E.164 in is the only form that round-trips: a bare 10-digit
string normalizes to ``+<NPA>...`` with the area code eaten as a country code and
never matches. (The dialplan side of this trap is handled in
``extensions.conf.from-fractel``.)

Safety / idempotence:
- Dry-run by default; ``--apply`` writes.
- Re-runnable: an existing row is left alone when already correct, and otherwise
  only gains ``inbound_workflow_id`` (and ``is_active``). Never duplicated.
- ``extra_metadata`` is merged, never replaced, and the existing ``pool`` key is
  never overwritten — some of these DIDs are also state-matched outbound caller
  IDs tagged ``pool = "state_cid"``, and clobbering that tag would break the
  state-CID reporting and rollback path. Inbound membership is tracked under a
  separate ``inbound_pool`` key.
- A number already owned by another organization or sitting under a different
  telephony configuration is reported as a conflict and skipped, not retried:
  ``(provider, account_id, address_normalized)`` is globally unique.
- ``--batch live-since-aug22`` and ``--limit`` support the canary-first rollout.

Caller-ID pool guard: Dograh seeds the outbound caller-ID rotation pool from
*every active row* for an (org, telephony config) — there is no pool-tag filter
in the selection path. If the ARI inbound config is also a campaign dialing
config, every row written here also becomes an outbound caller ID. When that
collision is detected, applying more than ``--canary-max`` rows requires
``--ack-shared-config``. Run ``resolve_inbound_ids.py`` first.

Run inside the dograh api container (has asyncpg + DATABASE_URL):
  docker cp deploy/dograh/inbound-dids/. dograh-api-1:/tmp/inbound-dids/
  docker exec dograh-api-1 python /tmp/inbound-dids/import_inbound_dids.py \
      --csv /tmp/inbound-dids/dograh-inbound-numbers.csv \
      --org-id 1 --tcid <ARI_CONFIG_ID> --workflow-id <WORKFLOW_ID> \
      --batch live-since-aug22 --limit 1            # dry run
  ... add --apply to write.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import re
from datetime import datetime, timezone

INBOUND_POOL_TAG = "fe_inbound"
DEFAULT_LABEL = "final-expense-inbound"

# live numbers first: they carry outbound traffic today and are the only ones
# that can generate a callback before the SBC pool cutover.
BATCH_ORDER = {"live-since-aug22": 0, "book207-new": 1}

E164_US = re.compile(r"^\+1[2-9][0-9]{9}$")


def load_rows(csv_path: str) -> tuple[list[dict], list[dict]]:
    """Return ``(valid, rejected)`` rows, valid ones in canary-first order."""
    valid: list[dict] = []
    rejected: list[dict] = []
    seen: set[str] = set()

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        cols = [c.strip() for c in (reader.fieldnames or [])]
        if "address" not in cols:
            raise SystemExit("CSV must have an 'address' column (also: npa, batch).")
        for i, raw in enumerate(reader):
            address = (raw.get("address") or "").strip()
            batch = (raw.get("batch") or "").strip()
            npa = (raw.get("npa") or "").strip()
            if not address:
                continue
            if not E164_US.match(address):
                # The CSV is documented as already-E.164. Anything else is a data
                # problem to surface, not to silently coerce.
                rejected.append({"address": address, "reason": "NOT_US_E164"})
                continue
            if address in seen:
                rejected.append({"address": address, "reason": "DUPLICATE_IN_CSV"})
                continue
            seen.add(address)
            valid.append(
                {
                    "address": address,
                    "npa": npa or address[2:5],
                    "batch": batch,
                    "_seq": i,
                }
            )

    valid.sort(key=lambda r: (BATCH_ORDER.get(r["batch"], 99), r["_seq"]))
    return valid, rejected


def merge_metadata(existing, npa: str, batch: str, stamp: str) -> dict:
    """Merge inbound tags into a row's metadata without disturbing ``pool``."""
    meta = existing
    if isinstance(meta, str):
        meta = json.loads(meta or "{}")
    meta = dict(meta or {})
    meta["inbound_pool"] = INBOUND_POOL_TAG
    meta["inbound_import_at"] = stamp
    if batch:
        meta["inbound_batch"] = batch
    if npa and not meta.get("npa"):
        meta["npa"] = npa
    return meta


async def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--csv", required=True)
    p.add_argument("--org-id", type=int, default=1)
    p.add_argument("--tcid", type=int, required=True, help="ARI telephony config id")
    p.add_argument("--workflow-id", type=int, required=True)
    p.add_argument("--batch", help="only import this batch (e.g. live-since-aug22)")
    p.add_argument("--limit", type=int, help="import at most N numbers (canary)")
    p.add_argument("--label", default=DEFAULT_LABEL)
    p.add_argument("--apply", action="store_true", help="write (default: dry-run)")
    p.add_argument(
        "--canary-max",
        type=int,
        default=1,
        help="max rows applied without --ack-shared-config when the ARI config is "
        "also a campaign dialing config (default: 1)",
    )
    p.add_argument(
        "--ack-shared-config",
        action="store_true",
        help="acknowledge that rows written here also become outbound caller IDs",
    )
    args = p.parse_args()

    import asyncpg

    dsn = os.environ.get("DATABASE_URL", "").replace(
        "postgresql+asyncpg://", "postgresql://"
    )
    if not dsn:
        raise SystemExit("DATABASE_URL not set")

    supplied, rejected = load_rows(args.csv)
    if args.batch:
        supplied = [r for r in supplied if r["batch"] == args.batch]
    total_selected = len(supplied)
    if args.limit is not None:
        supplied = supplied[: args.limit]

    now = datetime.now(timezone.utc)
    stamp = now.isoformat()

    report: dict = {
        "dry_run": not args.apply,
        "organization_id": args.org_id,
        "telephony_configuration_id": args.tcid,
        "inbound_workflow_id": args.workflow_id,
        "batch_filter": args.batch,
        "selected_by_filter": total_selected,
        "considered": len(supplied),
        "csv_rejected": rejected,
        "inserted": 0,
        "updated": 0,
        "activated": 0,
        "already_correct": 0,
        "conflicts": [],
        "by_batch": {},
    }

    conn = await asyncpg.connect(dsn=dsn)
    try:
        # --- Preconditions -------------------------------------------------
        wf = await conn.fetchrow(
            "select id, name, organization_id from workflows where id = $1",
            args.workflow_id,
        )
        if not wf:
            raise SystemExit(f"workflow id {args.workflow_id} not found")
        if wf["organization_id"] != args.org_id:
            raise SystemExit(
                f"workflow {args.workflow_id} belongs to org "
                f"{wf['organization_id']}, not {args.org_id}"
            )
        report["workflow_name"] = wf["name"]

        cfg = await conn.fetchrow(
            "select id, provider, organization_id from telephony_configurations "
            "where id = $1",
            args.tcid,
        )
        if not cfg:
            raise SystemExit(f"telephony configuration {args.tcid} not found")
        if (cfg["provider"] or "").lower() != "ari":
            raise SystemExit(
                f"telephony configuration {args.tcid} has provider "
                f"{cfg['provider']!r}, expected 'ari'"
            )
        report["telephony_provider"] = cfg["provider"]

        # --- Caller-ID pool collision guard --------------------------------
        camp = await conn.fetch(
            "select distinct telephony_configuration_id as tcid from campaigns "
            "where telephony_configuration_id is not null"
        )
        shared = args.tcid in {r["tcid"] for r in camp}
        report["shares_config_with_outbound_campaigns"] = shared
        if shared:
            report["caller_id_pool_warning"] = (
                f"telephony config {args.tcid} is also an outbound campaign dialing "
                "config. Dograh seeds the outbound caller-ID rotation pool from every "
                "active row for this (org, config), so each row written here also "
                "becomes an outbound caller ID."
            )
            if args.apply and len(supplied) > args.canary_max and not args.ack_shared_config:
                raise SystemExit(
                    json.dumps(
                        {
                            "aborted": "SHARED_CONFIG_NOT_ACKNOWLEDGED",
                            "detail": report["caller_id_pool_warning"],
                            "rows_requested": len(supplied),
                            "canary_max": args.canary_max,
                            "resolution": "re-run with --ack-shared-config once the "
                            "caller-ID impact is accepted, or load inbound rows under "
                            "a telephony config that campaigns do not dial on.",
                        },
                        indent=2,
                    )
                )

        # --- Classify against what is already there ------------------------
        addresses = [r["address"] for r in supplied]
        existing_rows = await conn.fetch(
            "select id, organization_id, telephony_configuration_id, "
            "address_normalized, is_active, inbound_workflow_id, label, "
            "extra_metadata from telephony_phone_numbers "
            "where address_normalized = any($1::text[])",
            addresses,
        )
        by_address: dict[str, list] = {}
        for r in existing_rows:
            by_address.setdefault(r["address_normalized"], []).append(r)

        to_insert: list[dict] = []
        to_update: list[tuple] = []
        for row in supplied:
            addr = row["address"]
            matches = by_address.get(addr, [])
            mine = [
                m
                for m in matches
                if m["organization_id"] == args.org_id
                and m["telephony_configuration_id"] == args.tcid
            ]
            other_org = [m for m in matches if m["organization_id"] != args.org_id]
            other_cfg = [
                m
                for m in matches
                if m["organization_id"] == args.org_id
                and m["telephony_configuration_id"] != args.tcid
            ]

            if not mine and other_org:
                report["conflicts"].append(
                    {"address": addr, "reason": "OWNED_BY_OTHER_ORGANIZATION"}
                )
                continue
            if not mine and other_cfg:
                report["conflicts"].append(
                    {
                        "address": addr,
                        "reason": "EXISTS_UNDER_OTHER_TELEPHONY_CONFIG",
                        "telephony_configuration_id": other_cfg[0][
                            "telephony_configuration_id"
                        ],
                        "detail": "(provider, account_id, address_normalized) is "
                        "globally unique; move or retire that row first.",
                    }
                )
                continue

            batch_stats = report["by_batch"].setdefault(
                row["batch"] or "(none)",
                {"inserted": 0, "updated": 0, "already_correct": 0},
            )

            if mine:
                r = mine[0]
                needs_wf = r["inbound_workflow_id"] != args.workflow_id
                needs_active = not r["is_active"]
                meta = merge_metadata(r["extra_metadata"], row["npa"], row["batch"], stamp)
                cur_meta = r["extra_metadata"]
                if isinstance(cur_meta, str):
                    cur_meta = json.loads(cur_meta or "{}")
                needs_meta = dict(cur_meta or {}) != meta

                if not (needs_wf or needs_active or needs_meta):
                    report["already_correct"] += 1
                    batch_stats["already_correct"] += 1
                    continue
                if needs_active:
                    report["activated"] += 1
                to_update.append((r["id"], json.dumps(meta), args.workflow_id, now))
                report["updated"] += 1
                batch_stats["updated"] += 1
            else:
                to_insert.append(row)
                report["inserted"] += 1
                batch_stats["inserted"] += 1

        # --- Write ----------------------------------------------------------
        if args.apply and (to_insert or to_update):
            async with conn.transaction():
                for row_id, meta_json, wf_id, ts in to_update:
                    await conn.execute(
                        "update telephony_phone_numbers set "
                        "inbound_workflow_id = $2, is_active = true, "
                        "extra_metadata = $3::json, updated_at = $4 where id = $1",
                        row_id,
                        wf_id,
                        meta_json,
                        ts,
                    )
                for row in to_insert:
                    meta = merge_metadata({}, row["npa"], row["batch"], stamp)
                    try:
                        await conn.execute(
                            "insert into telephony_phone_numbers "
                            "(organization_id, telephony_configuration_id, address, "
                            "address_normalized, address_type, country_code, label, "
                            "is_active, is_default_caller_id, inbound_workflow_id, "
                            "extra_metadata, created_at, updated_at) values "
                            "($1,$2,$3,$3,'pstn','US',$4,true,false,$5,$6::json,$7,$7)",
                            args.org_id,
                            args.tcid,
                            row["address"],
                            args.label,
                            args.workflow_id,
                            json.dumps(meta),
                            now,
                        )
                    except asyncpg.exceptions.UniqueViolationError as e:
                        # Lost a race, or a uniqueness dimension we did not
                        # pre-check. Record it; do not retry.
                        report["conflicts"].append(
                            {
                                "address": row["address"],
                                "reason": "UNIQUE_VIOLATION_ON_INSERT",
                                "detail": str(e),
                            }
                        )
                        report["inserted"] -= 1

        # --- Confirm from the database --------------------------------------
        if args.apply:
            confirmed = await conn.fetchrow(
                "select count(*) as n, "
                "count(*) filter (where inbound_workflow_id = $3) as mapped "
                "from telephony_phone_numbers "
                "where organization_id = $1 and telephony_configuration_id = $2 "
                "and is_active and extra_metadata->>'inbound_pool' = $4",
                args.org_id,
                args.tcid,
                args.workflow_id,
                INBOUND_POOL_TAG,
            )
            report["db_confirmed_active_inbound_rows"] = confirmed["n"]
            report["db_confirmed_mapped_to_workflow"] = confirmed["mapped"]
    finally:
        await conn.close()

    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
